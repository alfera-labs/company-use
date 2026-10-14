import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { connections } from '@coworker/core/db/schema';
import {
  claim_external_account_for_connection,
  claims_external_account_exclusively,
  type ExclusiveClaimIncumbent,
  type IncumbentLiveness,
  release_exclusive_account_claim,
} from '@runtime-platform/channels/exclusive_external_account_claims';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

type LivenessProbe = (incumbent: ExclusiveClaimIncumbent) => Promise<IncumbentLiveness>;

const native_slack = {
  provider_key: 'native',
  provider_config_key: 'native:slack',
} as const;

describe('claims_external_account_exclusively', () => {
  it('is true for native Slack and false for other providers', () => {
    expect(claims_external_account_exclusively(native_slack)).toBe(true);
    expect(
      claims_external_account_exclusively({
        provider_key: 'composio',
        provider_config_key: 'composio:notion',
      }),
    ).toBe(false);
    expect(
      claims_external_account_exclusively({ provider_key: 'native', provider_config_key: null }),
    ).toBe(false);
  });
});

describe('claim_external_account_for_connection', () => {
  it('claims a free team without touching other teams or providers', async () => {
    const db = await create_test_database();
    await seed_connection(db, { connection_id: 'conn_other_team', team_id: 'T_OTHER' });
    await seed_connection(db, {
      connection_id: 'conn_notion',
      team_id: 'T_SHARED',
      provider_config_key: 'composio:notion',
    });
    await seed_connection(db, {
      connection_id: 'conn_new',
      team_id: 'T_SHARED',
      connection_status: 'pending_setup',
    });

    const probe = vi.fn<LivenessProbe>();
    const result = await claim_external_account_for_connection(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      claiming_workspace_id: 'ws_new',
      claiming_connection_id: 'conn_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: probe,
    });

    expect(result).toEqual({ outcome: 'claimed', released: [] });
    expect(probe).not.toHaveBeenCalled();
    expect(await status_of(db, 'conn_other_team')).toBe('active');
    expect(await status_of(db, 'conn_notion')).toBe('active');
  });

  it('heals a same-workspace re-add by revoking the stale claim, without probing', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_old',
      team_id: 'T_SHARED',
      workspace_id: 'ws_1',
    });
    await seed_connection(db, {
      connection_id: 'conn_new',
      team_id: 'T_SHARED',
      workspace_id: 'ws_1',
      connection_status: 'pending_setup',
    });

    const probe = vi.fn<LivenessProbe>();
    const result = await claim_external_account_for_connection(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      claiming_workspace_id: 'ws_1',
      claiming_connection_id: 'conn_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: probe,
    });

    expect(result).toEqual({
      outcome: 'claimed',
      released: [{ connection_id: 'conn_old', workspace_id: 'ws_1' }],
    });
    expect(probe).not.toHaveBeenCalled();
    expect(await status_of(db, 'conn_old')).toBe('revoked');
  });

  it('blocks the claim and leaves the incumbent alone when a live owner exists elsewhere', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_owner',
      team_id: 'T_SHARED',
      workspace_id: 'ws_owner',
    });
    await seed_connection(db, {
      connection_id: 'conn_new',
      team_id: 'T_SHARED',
      workspace_id: 'ws_new',
      connection_status: 'pending_setup',
    });

    const result = await claim_external_account_for_connection(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      claiming_workspace_id: 'ws_new',
      claiming_connection_id: 'conn_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: async () => 'alive',
    });

    expect(result).toEqual({
      outcome: 'conflict',
      incumbent_workspace_id: 'ws_owner',
      incumbent_connection_id: 'conn_owner',
    });
    expect(await status_of(db, 'conn_owner')).toBe('active');
  });

  it('auto-releases a dead cross-workspace owner and claims the team', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_dead',
      team_id: 'T_SHARED',
      workspace_id: 'ws_dead',
    });
    await seed_connection(db, {
      connection_id: 'conn_new',
      team_id: 'T_SHARED',
      workspace_id: 'ws_new',
      connection_status: 'pending_setup',
    });

    const result = await claim_external_account_for_connection(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      claiming_workspace_id: 'ws_new',
      claiming_connection_id: 'conn_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: async () => 'dead',
    });

    expect(result).toEqual({
      outcome: 'claimed',
      released: [{ connection_id: 'conn_dead', workspace_id: 'ws_dead' }],
    });
    expect(await status_of(db, 'conn_dead')).toBe('revoked');
  });

  it('treats an unknown liveness result as blocking (conservative)', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_owner',
      team_id: 'T_SHARED',
      workspace_id: 'ws_owner',
    });
    await seed_connection(db, {
      connection_id: 'conn_new',
      team_id: 'T_SHARED',
      workspace_id: 'ws_new',
      connection_status: 'pending_setup',
    });

    const result = await claim_external_account_for_connection(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      claiming_workspace_id: 'ws_new',
      claiming_connection_id: 'conn_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: async () => 'unknown',
    });

    expect(result.outcome).toBe('conflict');
    expect(await status_of(db, 'conn_owner')).toBe('active');
  });

  it('does nothing for non-exclusive providers', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_notion_owner',
      team_id: 'ACCT_1',
      workspace_id: 'ws_1',
      provider_config_key: 'composio:notion',
    });

    const probe = vi.fn<LivenessProbe>();
    const result = await claim_external_account_for_connection(db, {
      provider_key: 'composio',
      provider_config_key: 'composio:notion',
      external_account_id: 'ACCT_1',
      claiming_workspace_id: 'ws_2',
      claiming_connection_id: 'conn_notion_new',
      actor_id: 'user_test',
      probe_incumbent_liveness: probe,
    });

    expect(result).toEqual({ outcome: 'not_exclusive' });
    expect(probe).not.toHaveBeenCalled();
    expect(await status_of(db, 'conn_notion_owner')).toBe('active');
  });
});

describe('release_exclusive_account_claim', () => {
  it('revokes the active claim for a team and is idempotent', async () => {
    const db = await create_test_database();
    await seed_connection(db, {
      connection_id: 'conn_owner',
      team_id: 'T_SHARED',
      workspace_id: 'ws_owner',
    });

    const first = await release_exclusive_account_claim(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      actor_id: 'system:slack',
    });
    const second = await release_exclusive_account_claim(db, {
      ...native_slack,
      external_account_id: 'T_SHARED',
      actor_id: 'system:slack',
    });

    expect(first).toEqual([{ connection_id: 'conn_owner', workspace_id: 'ws_owner' }]);
    expect(second).toEqual([]);
    expect(await status_of(db, 'conn_owner')).toBe('revoked');
  });
});

describe('exclusive-account unique index', () => {
  it('rejects a second active native Slack connection for the same team', async () => {
    const db = await create_test_database();
    await seed_connection(db, { connection_id: 'conn_a', team_id: 'T_DUP', workspace_id: 'ws_a' });

    await expect(
      seed_connection(db, { connection_id: 'conn_b', team_id: 'T_DUP', workspace_id: 'ws_b' }),
    ).rejects.toThrow();
  });

  it('allows active connections for two different teams and duplicate Composio accounts', async () => {
    const db = await create_test_database();
    await seed_connection(db, { connection_id: 'conn_t1', team_id: 'T1', workspace_id: 'ws_a' });
    await seed_connection(db, { connection_id: 'conn_t2', team_id: 'T2', workspace_id: 'ws_b' });
    await seed_connection(db, {
      connection_id: 'conn_pd_1',
      team_id: 'ACCT',
      workspace_id: 'ws_a',
      provider_config_key: 'composio:notion',
    });
    await seed_connection(db, {
      connection_id: 'conn_pd_2',
      team_id: 'ACCT',
      workspace_id: 'ws_b',
      provider_config_key: 'composio:notion',
    });

    expect(await status_of(db, 'conn_t1')).toBe('active');
    expect(await status_of(db, 'conn_pd_2')).toBe('active');
  });
});

async function status_of(
  db: Awaited<ReturnType<typeof create_test_database>>,
  connection_id: string,
) {
  const row = await db.query.connections.findFirst({
    where: eq(connections.connection_id, connection_id),
  });
  return row?.connection_status;
}

async function seed_connection(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: {
    connection_id: string;
    team_id: string;
    workspace_id?: string;
    provider_config_key?: string;
    connection_status?: string;
  },
) {
  const provider_config_key = input.provider_config_key ?? 'native:slack';
  const is_slack = provider_config_key === 'native:slack';
  await db.insert(connections).values({
    connection_id: input.connection_id,
    workspace_id: input.workspace_id ?? 'ws_new',
    app_id: 'app_test',
    connection_name: input.connection_id,
    connection_status: input.connection_status ?? 'active',
    connection_key: `${provider_config_key}:${input.connection_id}`,
    provider_key: is_slack ? 'native' : 'composio',
    provider_config_key,
    provider_config_version: 1,
    connection_profile_key: is_slack
      ? 'native:slack:oauth_bot'
      : `${provider_config_key}:managed_oauth`,
    connection_profile_version: 1,
    auth_method_key: 'oauth2',
    external_account_id: input.team_id,
    external_account_name: 'Test team',
    authorized_scopes: [],
    health_status: 'healthy',
    credentials: { bot_token: 'token' },
    provider_account: {},
    metadata: {},
    created_by: 'user_test',
    last_updated_by: 'user_test',
  });
}
