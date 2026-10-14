import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { read_workspace_skill_index } from '@runtime-platform/skills/read_workspace_skill_index';
import { unindexed_skill_hint } from '@runtime-platform/skills/skill_index_artifact';
import { describe, expect, it, vi } from 'vitest';

const agent_id = 'agt_test_workspace_skills';

const one_procedure = JSON.stringify({
  skill_index_version: 1,
  compiled_time: '2026-08-15T13:41:15.055Z',
  entries: [
    {
      skill_slug: 'quote-drafting',
      skill_name: 'Quote drafting',
      skill_hint: 'Build or fix a quote draft from a submitted questionnaire.',
      body_path: 'skills/quote-drafting/SKILL.md',
      content_hash: 'sha256:test',
      preloaded_tool_keys: [],
      available_on_source_types: null,
    },
  ],
});

const cut_short = one_procedure.slice(0, one_procedure.length - 40);

const missing_object = Object.assign(new Error('NoSuchKey'), { status: 404 });

function reads(index_text: string) {
  return vi.fn().mockResolvedValue(new TextEncoder().encode(index_text));
}

function lists(...folder_names: string[]) {
  return vi.fn().mockResolvedValue(folder_names);
}

async function workspace_on_layout(workspace_layout_version: number) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await create_volume(db, {
    workspace_id: bootstrap.workspace_id,
    volume_provider: 'archil',
    workspace_layout_version,
    volume_status: 'active',
    provider_volume_id: 'dsk_skill_index_test',
    provider_region: 'aws-us-east-1',
    actor_id: bootstrap.user_id,
  });
  return { db, workspace_id: bootstrap.workspace_id };
}

describe('reading a workspace procedure index off its volume', () => {
  it('asks for the key where a volume that keys by agent actually holds it', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);
    const read_bytes = reads(one_procedure);

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      read_bytes,
      lists(),
    );

    expect(read_bytes).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_volume_id: 'dsk_skill_index_test',
        volume_relative_path: `agents/${agent_id}/workspace/skills/INDEX.json`,
      }),
    );
    expect(index.entries.map((entry) => entry.skill_slug)).toEqual(['quote-drafting']);
  });

  it('asks for the older layout key on a volume still in one folder', async () => {
    const { db, workspace_id } = await workspace_on_layout(1);
    const read_bytes = reads(one_procedure);

    await read_workspace_skill_index(db, { workspace_id, agent_id }, read_bytes, lists());

    expect(read_bytes).toHaveBeenCalledWith(
      expect.objectContaining({ volume_relative_path: 'workspace/skills/INDEX.json' }),
    );
  });

  it('does not list the folder when the compiled index reads', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);
    const list_folders = lists('quote-drafting');

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      reads(one_procedure),
      list_folders,
    );

    expect(list_folders).not.toHaveBeenCalled();
    expect(index.entries[0]?.skill_hint).toContain('quote draft');
  });

  it('runs with the platform procedures when the volume records a layout this deploy cannot read', async () => {
    const { db, workspace_id } = await workspace_on_layout(99);
    const read_bytes = vi.fn();
    const list_folders = vi.fn();

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      read_bytes,
      list_folders,
    );

    expect(index.entries).toEqual([]);
    expect(read_bytes).not.toHaveBeenCalled();
    expect(list_folders).not.toHaveBeenCalled();
  });

  it('offers the procedures the folder shows when the index comes back cut short', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);
    const list_folders = lists('reply-to-inquiry', 'quote-drafting');

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      reads(cut_short),
      list_folders,
    );

    expect(list_folders).toHaveBeenCalledWith(
      expect.objectContaining({
        volume_relative_path: `agents/${agent_id}/workspace/skills`,
      }),
    );
    expect(index.entries.map((entry) => entry.skill_slug)).toEqual([
      'quote-drafting',
      'reply-to-inquiry',
    ]);
    expect(index.entries[0]?.skill_hint).toBe(unindexed_skill_hint);
    expect(index.entries[0]?.body_path).toBe('skills/quote-drafting/SKILL.md');
  });

  it('offers the procedures the folder shows when the index is missing entirely', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      vi.fn().mockRejectedValue(missing_object),
      lists('reply-to-inquiry'),
    );

    expect(index.entries.map((entry) => entry.skill_slug)).toEqual(['reply-to-inquiry']);
  });

  it('leaves the shipped template out of what it offers', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      vi.fn().mockRejectedValue(missing_object),
      lists('example-procedure'),
    );

    expect(index.entries).toEqual([]);
  });

  it('runs with the platform procedures when the folder cannot be listed either', async () => {
    const { db, workspace_id } = await workspace_on_layout(2);

    const index = await read_workspace_skill_index(
      db,
      { workspace_id, agent_id },
      vi.fn().mockRejectedValue(missing_object),
      vi.fn().mockRejectedValue(new Error('AccessDenied')),
    );

    expect(index.entries).toEqual([]);
  });
});
