import { connections, users, workspace_members, workspaces } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_credit_balance_microcents } from '@coworker/core/db/queries/billing';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { create_slack_fixture_manifest } from '@coworker/evals/slack_fixture_manifest';
import { provision_product_fixtures } from '@coworker/evals/slack_fixture_provisioner';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('Slack product fixture provisioning', () => {
  it('creates an isolated credited workspace and reuses healthy shared connections', async () => {
    const db = await create_test_database();
    const source = await provision_workspace_for_identity(db, {
      provider_key: 'test',
      provider_user_id: 'source-user',
      organization_id: 'source-org',
      email: 'source@example.com',
    });
    await db.insert(connections).values({
      connection_id: 'conn_source_gmail',
      workspace_id: source.workspace_id,
      app_id: 'app_gmail',
      connection_key: 'composio:gmail:source',
      connection_name: 'Gmail',
      connection_status: 'active',
      provider_key: 'composio',
      provider_config_key: 'composio:v1',
      connection_profile_key: 'composio:gmail:managed_oauth',
      auth_method_key: 'managed_oauth',
      external_user_key: 'ws_source',
      external_account_id: 'apn_source',
      health_status: 'healthy',
      connection_config: {},
      created_by: source.user_id,
      last_updated_by: source.user_id,
    });
    await db.insert(connections).values({
      connection_id: 'conn_source_private_gmail',
      workspace_id: source.workspace_id,
      app_id: 'app_gmail',
      connection_key: 'composio:gmail:private-source',
      connection_name: 'Private Gmail',
      connection_status: 'active',
      provider_key: 'composio',
      provider_config_key: 'composio:v1',
      connection_profile_key: 'composio:gmail:managed_oauth',
      auth_method_key: 'managed_oauth',
      external_user_key: 'ws_private_source',
      external_account_id: 'apn_private_source',
      health_status: 'healthy',
      connection_config: {
        connection_access_type: 'restricted',
        access: { allowed_users: [{ user_id: source.user_id }] },
      },
      created_by: source.user_id,
      last_updated_by: source.user_id,
    });
    const manifest = create_slack_fixture_manifest(
      'slack_operator',
      ['connection_001'],
      'fixtures@example.com',
    );

    const provisioned = await provision_product_fixtures(db, manifest, source.workspace_id);

    const fixture = provisioned.fixtures[0];
    expect(fixture).toMatchObject({
      account_email: 'fixtures+1@example.com',
      status: 'product_ready',
    });
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.workspace_id, fixture?.product_workspace_id as string));
    if (!workspace) throw new Error('Expected provisioned workspace');
    expect(workspace?.workspace_name).toBe('Alfera Eval 001 connection_001');
    expect(await get_credit_balance_microcents(db, workspace.workspace_id)).toBeGreaterThan(0);
    const members = await db
      .select({ email: users.email })
      .from(workspace_members)
      .innerJoin(users, eq(users.user_id, workspace_members.user_id))
      .where(eq(workspace_members.workspace_id, workspace.workspace_id));
    expect(members).toEqual([{ email: 'fixtures+1@example.com' }]);
    const cloned = await db
      .select()
      .from(connections)
      .where(eq(connections.workspace_id, workspace.workspace_id));
    expect(cloned).toHaveLength(1);
    expect(cloned[0]).toMatchObject({
      provider_key: 'composio',
      external_account_id: 'apn_source',
      external_user_key: 'ws_source',
    });
    expect(cloned.some((connection) => connection.connection_name === 'Private Gmail')).toBe(false);

    const reprovisioned = await provision_product_fixtures(db, provisioned, source.workspace_id);
    const cloned_after_rerun = await db
      .select()
      .from(connections)
      .where(eq(connections.workspace_id, workspace.workspace_id));
    expect(reprovisioned.fixtures[0]?.product_workspace_id).toBe(workspace.workspace_id);
    expect(cloned_after_rerun).toHaveLength(1);
  });
});
