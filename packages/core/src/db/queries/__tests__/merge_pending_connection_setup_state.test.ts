import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { merge_pending_connection_setup_state } from '@coworker/core/db/queries/connection_management';
import { connections } from '@coworker/core/db/schema';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type TestDatabase = Awaited<ReturnType<typeof create_test_database>>;

const workspace_id = 'ws_setup_state';
const connection_id = 'conn_setup_state';

async function insert_connection(
  db: TestDatabase,
  input: {
    connection_status: string;
    setup_state: ConnectionSetupStateData;
    workspace_id?: string;
  },
) {
  await db.insert(connections).values({
    connection_id,
    workspace_id: input.workspace_id ?? workspace_id,
    app_id: 'app_attio',
    connection_key: 'composio:attio:conn_setup_state',
    connection_name: 'Attio',
    connection_status: input.connection_status,
    provider_key: 'composio',
    provider_config_key: 'composio:attio',
    connection_profile_key: 'composio:attio:oauth2',
    auth_method_key: 'composio_managed_oauth',
    setup_state: input.setup_state,
    created_by: 'user_1',
    last_updated_by: 'user_1',
  });
}

async function read_setup_state(db: TestDatabase) {
  const row = await db.query.connections.findFirst({
    columns: { setup_state: true, last_updated_time: true },
    where: eq(connections.connection_id, connection_id),
  });
  if (!row) throw new Error('the test connection disappeared');
  return row;
}

describe('merge_pending_connection_setup_state', () => {
  it('changes only the keys in the patch', async () => {
    const db = await create_test_database();
    await insert_connection(db, {
      connection_status: 'pending_setup',
      setup_state: {
        setup_token: 'tok_keep_me',
        redirect_uri: 'http://app.localhost:3000/connect/callback',
      },
    });

    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_webhook_token: 'whk_1' },
    });

    expect((await read_setup_state(db)).setup_state).toEqual({
      setup_token: 'tok_keep_me',
      redirect_uri: 'http://app.localhost:3000/connect/callback',
      provider_webhook_token: 'whk_1',
    });
  });

  it('keeps both patches when two writers touch different keys', async () => {
    const db = await create_test_database();
    await insert_connection(db, {
      connection_status: 'pending_setup',
      setup_state: { setup_token: 'tok_1' },
    });

    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_webhook_token: 'whk_1' },
    });
    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_connect_link: 'https://connect.composio.dev/l/abc' },
    });

    expect((await read_setup_state(db)).setup_state).toEqual({
      setup_token: 'tok_1',
      provider_webhook_token: 'whk_1',
      provider_connect_link: 'https://connect.composio.dev/l/abc',
    });
  });

  it('replaces the value when the patch names a key that already exists', async () => {
    const db = await create_test_database();
    await insert_connection(db, {
      connection_status: 'pending_setup',
      setup_state: { setup_token: 'tok_1', provider_webhook_token: 'whk_old' },
    });

    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_webhook_token: 'whk_new' },
    });

    expect((await read_setup_state(db)).setup_state).toEqual({
      setup_token: 'tok_1',
      provider_webhook_token: 'whk_new',
    });
  });

  it('writes nothing once the connection is active', async () => {
    const db = await create_test_database();
    await insert_connection(db, {
      connection_status: 'active',
      setup_state: { setup_token: 'tok_1' },
    });
    const before = await read_setup_state(db);

    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_webhook_token: 'whk_1' },
    });

    const after = await read_setup_state(db);
    expect(after.setup_state).toEqual({ setup_token: 'tok_1' });
    expect(after.last_updated_time).toEqual(before.last_updated_time);
  });

  it('writes nothing when the workspace does not own the connection', async () => {
    const db = await create_test_database();
    await insert_connection(db, {
      connection_status: 'pending_setup',
      setup_state: { setup_token: 'tok_1' },
      workspace_id: 'ws_other_tenant',
    });

    await merge_pending_connection_setup_state(db, {
      workspace_id,
      connection_id,
      patch: { provider_webhook_token: 'whk_1' },
    });

    expect((await read_setup_state(db)).setup_state).toEqual({ setup_token: 'tok_1' });
  });
});
