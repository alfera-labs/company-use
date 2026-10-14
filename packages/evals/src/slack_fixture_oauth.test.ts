import { connections } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import {
  finalize_slack_fixture,
  fixture_slack_authorization_url,
} from '@coworker/evals/slack_fixture_oauth';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('Slack fixture OAuth', () => {
  it('removes a stale team hint so a new workspace can be selected', () => {
    const url = fixture_slack_authorization_url(
      'https://slack.com/oauth/v2/authorize?client_id=123&state=secret&team=T_OLD',
      'T_NEW',
    );

    expect(new URL(url).searchParams.get('team')).toBe('T_NEW');
    expect(new URL(url).searchParams.get('state')).toBe('secret');
  });

  it('rejects non-Slack authorization URLs', () => {
    expect(() =>
      fixture_slack_authorization_url('https://example.com/oauth/v2/authorize?state=secret'),
    ).toThrow('must use slack.com');
  });

  it('rejects OAuth completed in a different Slack workspace', async () => {
    const db = await create_test_database();
    const identity = await provision_workspace_for_identity(db, {
      provider_key: 'eval_fixture',
      provider_user_id: 'oauth-team-guard',
      organization_id: 'oauth-team-guard',
      membership_id: 'oauth-team-guard',
      email: 'fixtures+1@example.com',
    });
    await db.insert(connections).values({
      connection_id: 'conn_oauth_wrong_team',
      workspace_id: identity.workspace_id,
      app_id: 'app_eval_slack',
      connection_key: 'native:slack:T_WRONG',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      connection_profile_key: 'native:slack:oauth_bot',
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: 'T_WRONG',
      provider_account: {},
      created_by: identity.user_id,
      last_updated_by: identity.user_id,
    });

    await expect(
      finalize_slack_fixture(db, {
        task_id: 'connection_001',
        account_email: 'fixtures+1@example.com',
        slack_actor_email: 'fixtures@example.com',
        product_identity_key: 'slack_operator:connection_001',
        slack_workspace_name: 'Alfera Eval 001 connection_001',
        status: 'oauth_pending',
        product_user_id: identity.user_id,
        product_workspace_id: identity.workspace_id,
        slack_team_id: 'T_EXPECTED',
      }),
    ).rejects.toThrow('installed team T_WRONG, expected T_EXPECTED');
    const [rejected_connection] = await db
      .select({ connection_status: connections.connection_status })
      .from(connections)
      .where(eq(connections.connection_id, 'conn_oauth_wrong_team'));
    expect(rejected_connection?.connection_status).toBe('revoked');
  });
});
