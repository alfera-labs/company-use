import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { AppError } from '@coworker/shared';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import { write_notification } from '@runtime-platform/notifications/write_notification';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'pv_test',
  region: undefined,
  volume_workspace_path: 'agents/agt_test',
  layout: current_workspace_layout,
};

const missing_file = new AppError('workspace_file_not_found', 'That file does not exist.', 404);

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let workspace_id: string;
let agent_id: string;

const write_file = vi.fn(async () => ({ content_version: 'v1' }));
const replace_file = vi.fn(async () => ({ content_version: 'v2' }));

beforeEach(async () => {
  write_file.mockClear();
  replace_file.mockClear();
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
});

function park_a_notification(
  options: { ideas_file?: string; score?: number; only_the_principal_reads?: boolean } = {},
) {
  return write_notification(db, {
    workspace_id,
    agent_id,
    ...(options.only_the_principal_reads ? { only_the_principal_reads: true } : {}),
    actor_id: 'system:test',
    written_by: 'run',
    now: new Date('2026-09-15T12:00:00Z'),
    policy_readers: {
      resolve_address: async () => address,
      read_file: async () => {
        throw missing_file;
      },
    },
    ideas_writers: {
      resolve_address: async () => address,
      read_file: async () => {
        if (options.ideas_file === undefined) throw missing_file;
        return new TextEncoder().encode(options.ideas_file);
      },
      write_file: write_file as never,
      replace_file: replace_file as never,
    },
    notification: {
      automation_id: 'atm_billing',
      run_id: 'run_1',
      subject: `thread_${options.score ?? 20}`,
      claim: 'is waiting on a reply',
      title: 'The vendor has a yearly plan',
      body: 'Their site lists a lower yearly price than the one we pay.',
      urgency: 'fyi',
      evidence: { brain_slugs: ['vendors/hosting'] },
      score: options.score ?? 20,
      reason: 'it may be worth asking about next time',
    },
  });
}

function written_text(call: ReturnType<typeof vi.fn>) {
  const [, input] = call.mock.calls[0] ?? [];
  return new TextDecoder().decode((input as { data: Uint8Array }).data);
}

describe('a parked notification', () => {
  it('creates ideas.md with the idea as its first section', async () => {
    const result = await park_a_notification();

    expect(result.outcome).toBe('add_to_ideas_list');
    expect(write_file).toHaveBeenCalledTimes(1);
    const text = written_text(write_file);
    expect(text).toContain('# Ideas');
    expect(text).toContain('## 2026-09-15 — The vendor has a yearly plan');
    expect(text).toContain('Because: it may be worth asking about next time');
  });

  it('appends to the ideas already there, keeping them', async () => {
    await park_a_notification({
      ideas_file: '# Ideas\n\n## 2026-09-01 — An older idea\n\nKeep me.\n',
    });

    expect(write_file).not.toHaveBeenCalled();
    const text = written_text(replace_file);
    expect(text).toContain('## 2026-09-01 — An older idea');
    expect(text).toContain('## 2026-09-15 — The vendor has a yearly plan');
  });

  it('writes nothing when the outcome is not an idea', async () => {
    const discarded = await park_a_notification({ score: 5 });

    expect(discarded.outcome).toBe('drop_with_reason');
    expect(write_file).not.toHaveBeenCalled();
    expect(replace_file).not.toHaveBeenCalled();
  });
});

describe('a parked notification that only one person may read', () => {
  it('stays out of ideas.md, which every member of the workspace can open', async () => {
    const result = await park_a_notification({ only_the_principal_reads: true });

    expect(result.outcome).toBe('add_to_ideas_list');
    expect(write_file).not.toHaveBeenCalled();
    expect(replace_file).not.toHaveBeenCalled();
  });
});
