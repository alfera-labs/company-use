import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { find_pending_connection_setup_by_short_code } from '@coworker/core/db/queries/connection_setup_short_code';
import { connections } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

type TestDatabase = Awaited<ReturnType<typeof create_test_database>>;

async function insert_connection(
  db: TestDatabase,
  input: { connection_id: string; connection_status: string; setup_token: string },
) {
  await db.insert(connections).values({
    connection_id: input.connection_id,
    workspace_id: 'ws_short_code',
    app_id: 'app_notion',
    connection_key: `composio:notion:${input.connection_id}`,
    connection_name: 'Notion',
    connection_status: input.connection_status,
    provider_key: 'composio',
    provider_config_key: 'composio:notion',
    connection_profile_key: 'composio:notion:oauth2',
    auth_method_key: 'composio_managed_oauth',
    setup_state: { setup_token: input.setup_token },
    created_by: 'user_1',
    last_updated_by: 'user_1',
  });
}

const pending = {
  connection_id: 'conn_pending',
  connection_status: 'pending_setup',
  setup_token: 'TESTsetup_token_1_for_tests_only_abcdefghij',
};

describe('find_pending_connection_setup_by_short_code', () => {
  it('finds the pending setup from the first 12 characters of its token', async () => {
    const db = await create_test_database();
    await insert_connection(db, pending);

    expect(await find_pending_connection_setup_by_short_code(db, 'TESTsetup_to')).toEqual({
      connection_id: 'conn_pending',
      setup_token: pending.setup_token,
    });
  });

  it('finds nothing for an unknown code, a short code, or a finished setup', async () => {
    const db = await create_test_database();
    await insert_connection(db, { ...pending, connection_status: 'active' });

    expect(await find_pending_connection_setup_by_short_code(db, 'TESTsetup_to')).toBeNull();
    expect(await find_pending_connection_setup_by_short_code(db, 'ZZZZZZZZZZZZ')).toBeNull();
    expect(await find_pending_connection_setup_by_short_code(db, 'TEST')).toBeNull();
  });

  it('refuses a code that matches two pending setups', async () => {
    const db = await create_test_database();
    await insert_connection(db, pending);
    await insert_connection(db, {
      ...pending,
      connection_id: 'conn_twin',
      setup_token: 'TESTsetup_token_2_for_tests_only_abcdefghij',
    });

    expect(await find_pending_connection_setup_by_short_code(db, 'TESTsetup_to')).toBeNull();
  });
});
