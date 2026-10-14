import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { restrict_connection_to_one_person } from '@coworker/core/db/queries/connection_people';
import { connections } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider_call = vi.fn(async () => ({ success: true as const, data: { output: 'ran' } }));
vi.mock('@runtime-platform/tools/catalog_tool_executors', () => ({
  find_catalog_tool_executor: () => provider_call,
}));

const { execute_catalog_tool_for_person } = await import(
  '@runtime-platform/tools/execute_catalog_tool_for_person'
);

const slack_node_key = 'slack-read_history-1';
let db: Awaited<ReturnType<typeof create_test_database>>;
let workspace_id: string;

beforeEach(async () => {
  provider_call.mockClear();
  db = await create_test_database();
  workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
  await seed_runtime_tool_catalog(db);
  const slack = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  const action = await get_tool_catalog_entry(db, { workspace_id, node_key: slack_node_key });
  if (!slack || !action) throw new Error('Slack seed missing');
  await db.insert(connections).values({
    connection_id: 'conn_alice',
    workspace_id,
    app_id: slack.app_id,
    connection_key: 'native:slack:conn_alice',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_alice',
    authorized_scopes: action.required_scopes,
    health_status: 'healthy',
    connected_by: 'user_alice',
    created_by: 'test',
    last_updated_by: 'test',
  });
  await restrict_connection_to_one_person(db, {
    workspace_id,
    connection_id: 'conn_alice',
    user_id: 'user_alice',
  });
});

function run_as(user_id: string, node_key = slack_node_key) {
  return execute_catalog_tool_for_person(db, {
    workspace_id,
    user_id,
    node_key,
    connection_id: 'conn_alice',
    tool_input: {},
  });
}

describe('execute_catalog_tool_for_person', () => {
  it('refuses a teammate on a connection restricted to somebody else', async () => {
    const result = await run_as('user_bob');

    expect(result).toMatchObject({
      success: false,
      error: { code: 'access_denied', message: 'That connection is private to somebody else.' },
    });
    expect(provider_call).not.toHaveBeenCalled();
  });

  it('lets the person the connection belongs to through to the provider', async () => {
    const result = await run_as('user_alice');

    expect(result).toEqual({ success: true, data: { output: 'ran' } });
    expect(provider_call).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ actor_id: 'user_alice', connection_id: 'conn_alice' }),
      expect.objectContaining({ node_key: slack_node_key }),
      expect.objectContaining({ connection_id: 'conn_alice' }),
    );
  });

  it('says the action is missing when the catalog has no such node', async () => {
    const result = await run_as('user_alice', 'gmail-no_such_action-1');

    expect(result).toMatchObject({ success: false, error: { code: 'node_missing' } });
    expect(provider_call).not.toHaveBeenCalled();
  });
});
