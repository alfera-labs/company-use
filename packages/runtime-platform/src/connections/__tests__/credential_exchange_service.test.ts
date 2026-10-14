import { plan_egress_headers } from '@coworker/core/credentials/egress_header_rules';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_credentials_to_deliver } from '@coworker/core/db/queries/connection_credential_delivery';
import { insert_workspace_credential } from '@coworker/core/db/queries/connection_credentials';
import { apps, connections } from '@coworker/core/db/schema';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import { exchange_credential_for_connection } from '@runtime-platform/connections/credential_exchange_service';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const acme_planner_recipe = {
  visit_first: 'https://www.acmebooking.com/signin',
  post_credentials_to: 'https://www.acmebooking.com/api/account/signin',
  send_fields: { username: 'username', password: 'password' },
  echo_cookie_into_header: { cookie_named: 'XSRF-TOKEN', into_header: 'X-XSRF-TOKEN' },
  always_send_headers: {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Vendor-API-Version': '2019-06-10',
    'X-Requested-With': 'XMLHttpRequest',
  },
  successful_when_field: 'result',
  successful_when_value: 'success',
  rejected_when_any_field_present: ['SIGNIN_FAIL'],
  read_wait_minutes_from_field: 'PASSWORD_WAIT',
  session_lasts_minutes: 1440,
  keep_cookies_named: ['session', 'XSRF-TOKEN'],
};

const workspace_id = 'ws_credential_exchange';

function answer(body: unknown, set_cookie: string[] = []) {
  return {
    headers: { getSetCookie: () => set_cookie },
    json: async () => body,
  } as unknown as Response;
}

const visitor_cookies = ['session=abc123; Path=/; HttpOnly', 'XSRF-TOKEN=xsrf789; Path=/'];

function stub_vendor(login_body: unknown) {
  const send = vi
    .fn()
    .mockResolvedValueOnce(answer('', visitor_cookies))
    .mockResolvedValueOnce(answer(login_body));
  vi.stubGlobal('fetch', send);
  return send;
}

async function create_connection_needing_exchange(
  db: Awaited<ReturnType<typeof create_test_database>>,
) {
  return insert_workspace_credential(db, {
    workspace_id,
    created_by: 'user_1',
    display_name: 'Acme Planner',
    allowed_hosts: ['www.acmebooking.com'],
    secret_values: { username: 'test-account@example.invalid', password: 'not-a-real-password' },
    exchange_the_credential_by: {
      exchange_kind: 'api_login',
      stop_after_failed_attempts: 1,
      recipe: acme_planner_recipe,
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('exchange_credential_for_connection', () => {
  it('stores the session beside the password and delivers only the session', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ result: 'success' });

    const report = await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });

    expect(report).toMatchObject({ exchanged: true });
    const [connection] = await db
      .select()
      .from(connections)
      .where(eq(connections.connection_id, created.connection_id));
    const stored = read_connection_credential_values(connection?.credentials);

    expect(stored.password).toBe('not-a-real-password');
    expect(stored['from_the_exchange.Cookie']).toBe('session=abc123; XSRF-TOKEN=xsrf789');
    expect(stored['from_the_exchange.X-XSRF-TOKEN']).toBe('xsrf789');
    expect(connection?.credential_expiry_time).toBeInstanceOf(Date);
    expect(connection?.health_status).toBe('healthy');
  });

  it('generates delivery rules that name the session and never the password', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ result: 'success' });

    await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });

    const [app] = await db.select().from(apps).where(eq(apps.app_id, created.app_id));
    const config = app?.app_config;
    const delivery_rules = config?.add_to_every_request ?? [];

    expect(delivery_rules.map((rule) => rule.take_the_value_from).sort()).toEqual([
      'from_the_exchange.Cookie',
      'from_the_exchange.X-XSRF-TOKEN',
    ]);
    expect(JSON.stringify(delivery_rules)).not.toContain('password');

    expect(config?.api_protocol_headers).toEqual({
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Vendor-API-Version': '2019-06-10',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('records a rejection and then refuses to spend a second attempt', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ SIGNIN_FAIL: true });

    const first = await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });
    expect(first).toMatchObject({ exchanged: false, outcome: 'rejected' });

    const send_again = stub_vendor({ result: 'success' });
    const second = await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });

    expect(second).toMatchObject({ exchanged: false, outcome: 'rejected' });
    expect(send_again).not.toHaveBeenCalled();
  });

  it("honours the vendor's own wait instead of retrying into a lockout", async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ PASSWORD_WAIT: 30 });

    const report = await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
      now: new Date('2026-07-31T12:00:00.000Z'),
    });

    expect(report).toMatchObject({
      exchanged: false,
      outcome: 'rate_limited',
      retry_allowed_after_time: '2026-07-31T12:30:00.000Z',
    });

    const send_again = stub_vendor({ result: 'success' });
    await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
      now: new Date('2026-07-31T12:29:00.000Z'),
    });
    expect(send_again).not.toHaveBeenCalled();
  });

  it('reports that there is nothing to exchange rather than failing', async () => {
    const db = await create_test_database();
    const created = await insert_workspace_credential(db, {
      workspace_id,
      created_by: 'user_1',
      display_name: 'Plain API key',
      allowed_hosts: ['api.example.com'],
      secret_values: { api_key: 'k_123' },
    });

    expect(
      await exchange_credential_for_connection({
        db,
        workspace_id,
        connection_id: created.connection_id,
      }),
    ).toMatchObject({ exchanged: false, outcome: 'nothing_to_exchange' });
  });

  it('does not reach into another workspace', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);

    await expect(
      exchange_credential_for_connection({
        db,
        workspace_id: 'ws_someone_else',
        connection_id: created.connection_id,
      }),
    ).rejects.toThrow('connection_not_found');
  });

  it('produces egress headers the door can attach, carrying no password', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ result: 'success' });

    await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });

    const plan = plan_egress_headers(
      await list_credentials_to_deliver(db, { workspace_id, now: new Date() }),
    );

    expect(plan.could_not_be_attached).toEqual([]);
    expect(plan.headers_by_host).toEqual({
      'www.acmebooking.com': {
        Cookie: 'session=abc123; XSRF-TOKEN=xsrf789',
        'X-XSRF-TOKEN': 'xsrf789',
      },
    });
    expect(JSON.stringify(plan)).not.toContain('not-a-real-password');
  });

  it('never attaches a content-negotiation header to the whole host', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ result: 'success' });

    await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
    });

    const plan = plan_egress_headers(
      await list_credentials_to_deliver(db, { workspace_id, now: new Date() }),
    );

    const attached = Object.keys(plan.headers_by_host['www.acmebooking.com'] ?? {});
    for (const header of ['Accept', 'Content-Type', 'X-Requested-With', 'X-Vendor-API-Version']) {
      expect(attached).not.toContain(header);
    }
  });

  it('stops delivering a session once it has expired', async () => {
    const db = await create_test_database();
    const created = await create_connection_needing_exchange(db);
    stub_vendor({ result: 'success' });

    await exchange_credential_for_connection({
      db,
      workspace_id,
      connection_id: created.connection_id,
      now: new Date('2026-07-31T12:00:00.000Z'),
    });

    const after_expiry = new Date('2026-08-01T12:01:00.000Z');
    expect(await list_credentials_to_deliver(db, { workspace_id, now: after_expiry })).toEqual([]);
  });
});
