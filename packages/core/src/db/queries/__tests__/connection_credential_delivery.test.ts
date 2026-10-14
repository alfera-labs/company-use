import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_credentials_to_deliver } from '@coworker/core/db/queries/connection_credential_delivery';
import { insert_workspace_credential } from '@coworker/core/db/queries/connection_credentials';
import { connections } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const workspace_id = 'ws_delivery';
const now = new Date('2026-07-31T12:00:00.000Z');

const rule = {
  when_the_request_goes_to: 'www.acmebooking.com',
  take_the_value_from: 'api_key',
  encode_the_value_as: 'as_is',
  put_it_in_header: 'X-API-Key',
  written_as: '{value}',
  worked_out_by: 'human_override',
} as const;

function create_credential(db: Awaited<ReturnType<typeof create_test_database>>) {
  return insert_workspace_credential(db, {
    workspace_id,
    created_by: 'user_1',
    display_name: 'Acme Planner',
    allowed_hosts: ['www.acmebooking.com'],
    secret_values: { api_key: 'k_123' },
    add_to_every_request: [rule],
  });
}

describe('list_credentials_to_deliver', () => {
  it('returns the rules and the decrypted values behind them', async () => {
    const db = await create_test_database();
    await create_credential(db);

    const [credential] = await list_credentials_to_deliver(db, { workspace_id, now });

    expect(credential?.connection_name).toBe('Acme Planner');
    expect(credential?.rules[0]?.put_it_in_header).toBe('X-API-Key');
    expect(credential?.field_values.api_key).toBe('k_123');
  });

  it('leaves out a credential whose session has already expired', async () => {
    const db = await create_test_database();
    const created = await create_credential(db);
    await db
      .update(connections)
      .set({ credential_expiry_time: new Date('2026-07-31T11:00:00.000Z') })
      .where(eq(connections.connection_id, created.connection_id));

    expect(await list_credentials_to_deliver(db, { workspace_id, now })).toEqual([]);
  });

  it('keeps a credential whose session is still alive', async () => {
    const db = await create_test_database();
    const created = await create_credential(db);
    await db
      .update(connections)
      .set({ credential_expiry_time: new Date('2026-07-31T13:00:00.000Z') })
      .where(eq(connections.connection_id, created.connection_id));

    expect(await list_credentials_to_deliver(db, { workspace_id, now })).toHaveLength(1);
  });

  it('leaves out a credential that was revoked', async () => {
    const db = await create_test_database();
    const created = await create_credential(db);
    await db
      .update(connections)
      .set({ revoked_time: new Date() })
      .where(eq(connections.connection_id, created.connection_id));

    expect(await list_credentials_to_deliver(db, { workspace_id, now })).toEqual([]);
  });

  it('does not hand one workspace another workspace credentials', async () => {
    const db = await create_test_database();
    await create_credential(db);

    expect(await list_credentials_to_deliver(db, { workspace_id: 'ws_someone_else', now })).toEqual(
      [],
    );
  });

  it('skips an app that has no delivery rules rather than returning an empty one', async () => {
    const db = await create_test_database();
    await insert_workspace_credential(db, {
      workspace_id,
      created_by: 'user_1',
      display_name: 'No rules yet',
      allowed_hosts: ['api.example.com'],
      secret_values: { api_key: 'k_456' },
    });

    expect(await list_credentials_to_deliver(db, { workspace_id, now })).toEqual([]);
  });
});
