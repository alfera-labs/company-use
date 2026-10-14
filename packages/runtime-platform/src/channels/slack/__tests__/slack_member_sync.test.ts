import { create_scope_item } from '@coworker/core/db/__tests__/create_scope_item';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import {
  slack_channel_scope_key,
  sync_slack_channel_members,
} from '@runtime-platform/channels/slack/slack_member_sync';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  conversations_members: vi.fn(),
  users_info: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = { members: slack_sdk.conversations_members };
    users = { info: slack_sdk.users_info };
    constructor(_token: string) {}
  },
}));

const team_id = 'T1';
const channel_id = 'C1';
const scope_key = slack_channel_scope_key(team_id, channel_id);
const first_sweep_time = new Date('2026-10-03T09:00:00.000Z');
const second_sweep_time = new Date('2026-10-03T10:00:00.000Z');

function member_profile(
  user_id: string,
  flags: Partial<{ is_restricted: boolean; is_ultra_restricted: boolean }> = {},
) {
  return { id: user_id, is_restricted: false, is_ultra_restricted: false, ...flags };
}

async function workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const owner = { workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id };
  await create_scope_item(db, owner, scope_key);
  return { db, ...owner };
}

function scope_rows(db: Parameters<typeof list_grants_for_resource>[0], workspace_id: string) {
  return list_grants_for_resource(db, {
    workspace_id,
    resource_type: 'memory_scope',
    resource_id: scope_key,
  });
}

describe('sync_slack_channel_members', () => {
  afterEach(() => {
    slack_sdk.conversations_members.mockReset();
    slack_sdk.users_info.mockReset();
  });

  it('writes a source_actor grant per Slack channel member', async () => {
    const { db, ...owner } = await workspace();
    slack_sdk.conversations_members.mockResolvedValue({ members: ['U_ALICE'] });
    slack_sdk.users_info.mockResolvedValue({ user: member_profile('U_ALICE') });

    const result = await sync_slack_channel_members({
      db,
      workspace_id: owner.workspace_id,
      team_id,
      channel_id,
      token: 'xoxb-test',
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      actor_id: owner.actor_id,
    });

    expect(result.outcome).toBe('swept');
    const rows = await scope_rows(db, owner.workspace_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.grantee_type).toBe('source_actor');
  });

  it('tags a restricted Slack user as a guest and a full member as member', async () => {
    const { db, ...owner } = await workspace();
    slack_sdk.conversations_members.mockResolvedValue({ members: ['U_GUEST', 'U_FULL'] });
    slack_sdk.users_info.mockImplementation(({ user }: { user: string }) =>
      Promise.resolve({
        user:
          user === 'U_GUEST'
            ? member_profile('U_GUEST', { is_restricted: true })
            : member_profile('U_FULL'),
      }),
    );

    await sync_slack_channel_members({
      db,
      workspace_id: owner.workspace_id,
      team_id,
      channel_id,
      token: 'xoxb-test',
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      actor_id: owner.actor_id,
    });

    const rows = await scope_rows(db, owner.workspace_id);
    const kind_by_grantee_id = new Map(
      rows.map((row) => [row.grantee_id, row.metadata.member_kind]),
    );
    expect([...kind_by_grantee_id.values()].sort()).toEqual(['guest', 'member']);
  });

  it('removes exactly the member who left Slack on the next sync', async () => {
    const { db, ...owner } = await workspace();
    slack_sdk.conversations_members.mockResolvedValueOnce({ members: ['U_ALICE', 'U_BOB'] });
    slack_sdk.users_info.mockResolvedValue({ user: member_profile('U_STAYING') });

    await sync_slack_channel_members({
      db,
      workspace_id: owner.workspace_id,
      team_id,
      channel_id,
      token: 'xoxb-test',
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      actor_id: owner.actor_id,
    });
    const rows_after_first_sync = await scope_rows(db, owner.workspace_id);
    expect(rows_after_first_sync).toHaveLength(2);

    slack_sdk.conversations_members.mockResolvedValueOnce({ members: ['U_ALICE'] });
    const second = await sync_slack_channel_members({
      db,
      workspace_id: owner.workspace_id,
      team_id,
      channel_id,
      token: 'xoxb-test',
      sweep_id: 'sweep_2',
      swept_time: second_sweep_time,
      actor_id: owner.actor_id,
    });

    expect(second.outcome === 'swept' && second.removed).toHaveLength(1);
    const rows_after_second_sync = await scope_rows(db, owner.workspace_id);
    expect(rows_after_second_sync).toHaveLength(1);
  });

  it('fails closed when the channel scope has no brain item', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    slack_sdk.conversations_members.mockResolvedValue({ members: ['U_ALICE'] });
    slack_sdk.users_info.mockResolvedValue({ user: member_profile('U_ALICE') });

    const result = await sync_slack_channel_members({
      db,
      workspace_id: bootstrap.workspace_id,
      team_id,
      channel_id: 'C_UNKNOWN',
      token: 'xoxb-test',
      sweep_id: 'sweep_1',
      swept_time: first_sweep_time,
      actor_id: bootstrap.user_id,
    });

    expect(result).toEqual({ outcome: 'scope_item_not_found' });
  });
});
