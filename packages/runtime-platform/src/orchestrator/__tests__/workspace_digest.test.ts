import {
  build_workspace_digest,
  write_workspace_digest,
} from '@runtime-platform/orchestrator/workspace_digest';
import { unindexed_skill_hint } from '@runtime-platform/skills/skill_index_artifact';
import { describe, expect, it } from 'vitest';

describe('a workspace on an older layout', () => {
  const environment = (layout_version: number) => ({
    env_key: 'e',
    env_kind: 'remote_sandbox' as const,
    metadata: { workspace_layout_version: layout_version },
    list: async () => [],
  });

  it('is described by what it has, not by what this deploy would give it', async () => {
    const digest = await build_workspace_digest(environment(1), { entries: [] } as never);
    expect(digest.text).not.toContain('people');
    expect(digest.text).not.toContain('companies');
  });

  it('while the current layout is still described in full', async () => {
    const digest = await build_workspace_digest(environment(2), { entries: [] } as never);
    expect(digest.text).toContain('people');
    expect(digest.text).toContain('daily-logs');
  });

  it('keeps its own WORKSPACE.md', async () => {
    const written: string[] = [];
    await write_workspace_digest(
      { ...environment(1), write: async (path: string) => void written.push(path) },
      { text: 'generated' },
    );
    expect(written).toEqual([]);
  });
});

describe('the procedure count', () => {
  const empty_index = { entries: [] } as never;
  const workspace = (folders: string[] | Error) => ({
    env_key: 'e',
    env_kind: 'remote_sandbox' as const,
    metadata: { workspace_layout_version: 2 },
    list: async (input?: { path?: string }) => {
      if (folders instanceof Error) throw folders;
      if (input?.path !== 'skills') return [];
      return folders.map((name) => ({ name, path: `skills/${name}`, kind: 'directory' as const }));
    },
  });

  it('comes off the disk, not off the compiled index', async () => {
    const digest = await build_workspace_digest(
      workspace(['quote-drafting', 'reply-to-inquiry', 'INDEX.json', 'index.md']),
      empty_index,
    );

    expect(digest.text).toContain('2 procedures');
    expect(digest.text).toContain('quote-drafting');
    expect(digest.text).not.toContain('No procedures written yet');
  });

  it('names a procedure the index does not carry rather than hiding it', async () => {
    const index = {
      entries: [{ skill_slug: 'quote-drafting', skill_hint: 'Build a quote.' }],
    } as never;

    const digest = await build_workspace_digest(
      workspace(['quote-drafting', 'reply-to-inquiry']),
      index,
    );

    expect(digest.text).toContain('quote-drafting — Build a quote.');
    expect(digest.text).toContain(`reply-to-inquiry — ${unindexed_skill_hint}`);
  });

  it('says it could not read skills/ rather than reporting a count it did not measure', async () => {
    const digest = await build_workspace_digest(workspace(new Error('volume gone')), empty_index);

    expect(digest.text).toContain('procedures unreadable');
    expect(digest.text).not.toContain('0 procedures');
  });

  it('still invites the first one when the folder is genuinely empty', async () => {
    const digest = await build_workspace_digest(workspace([]), empty_index);

    expect(digest.text).toContain('0 procedures');
    expect(digest.text).toContain('No procedures written yet');
  });
});
