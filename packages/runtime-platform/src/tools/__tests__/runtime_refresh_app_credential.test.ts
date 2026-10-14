import type { SessionEnv } from '@agent-core/environment';
import { credential_exchange_method_schema } from '@coworker/core/credentials/credential_exchange';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { insert_workspace_credential } from '@coworker/core/db/queries/connection_credentials';
import { apps, connections } from '@coworker/core/db/schema';
import { runtime_refresh_app_credential_tool } from '@runtime-platform/tools/definitions/runtime_refresh_app_credential';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const update_network = vi.fn();
vi.mock('e2b', () => ({
  Sandbox: { updateNetwork: (...args: unknown[]) => update_network(...args) },
}));

const workspace_id = 'ws_refresh_tool';
const host = 'www.acmebooking.com';

const exchange_the_credential_by = credential_exchange_method_schema.parse({
  exchange_kind: 'api_login',
  stop_after_failed_attempts: 1,
  recipe: {
    visit_first: `https://${host}/signin`,
    post_credentials_to: `https://${host}/api/account/signin`,
    send_fields: { username: 'username', password: 'password' },
    successful_when_field: 'result',
    successful_when_value: 'success',
    rejected_when_any_field_present: ['SIGNIN_FAIL'],
    read_wait_minutes_from_field: 'PASSWORD_WAIT',
    keep_cookies_named: ['session'],
  },
});

function answer(body: unknown, set_cookie: string[] = []) {
  return {
    headers: { getSetCookie: () => set_cookie },
    json: async () => body,
  } as unknown as Response;
}

function stub_vendor(login_body: unknown) {
  const send = vi
    .fn()
    .mockResolvedValueOnce(answer('', ['session=fresh999; Path=/']))
    .mockResolvedValueOnce(answer(login_body));
  vi.stubGlobal('fetch', send);
  return send;
}

function create_credential(db: Awaited<ReturnType<typeof create_test_database>>) {
  return insert_workspace_credential(db, {
    workspace_id,
    created_by: 'user_1',
    display_name: 'Acme Planner',
    allowed_hosts: [host],
    secret_values: { username: 'test-account@example.invalid', password: 'not-a-real-password' },
    exchange_the_credential_by,
  });
}

function create_context(
  db: Awaited<ReturnType<typeof create_test_database>>,
  environment_provider = 'e2b',
): RuntimeToolExecutionContext {
  return {
    db,
    workspace_id,
    session_id: 'ses_1',
    run_id: 'run_1',
    actor_id: 'user_1',
    environment: {
      metadata: { environment_provider, provider_sandbox_id: 'sbx_123' },
    } as unknown as SessionEnv,
  };
}

function create_context_on_a_live_sandbox(
  db: Awaited<ReturnType<typeof create_test_database>>,
  reports_sandbox_id: string,
): RuntimeToolExecutionContext {
  return {
    db,
    workspace_id,
    session_id: 'ses_1',
    run_id: 'run_1',
    actor_id: 'user_1',
    environment: {
      metadata: { environment_provider: 'e2b', provider_sandbox_id: 'sbx_123' },
      exec: async () => ({ exit_code: 0, stdout: `${reports_sandbox_id}\n`, stderr: '' }),
    } as unknown as SessionEnv,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  update_network.mockClear();
});

const run = (context: RuntimeToolExecutionContext, input: { host: string }) =>
  runtime_refresh_app_credential_tool.execute(input, context);

describe('runtime-refresh_app_credential-1', () => {
  it('signs in again and pushes the new session onto the running sandbox', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const result = await run(create_context(db), { host });

    expect(result).toMatchObject({
      success: true,
      data: { refreshed: true, exchanged: true, host },
    });
    expect(update_network).toHaveBeenCalledWith('sbx_123', {
      rules: { [host]: [{ transform: { headers: { Cookie: 'session=fresh999' } } }] },
    });
  });

  it('records which sandbox it attached to and which one serves the session', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const result = await run(create_context_on_a_live_sandbox(db, 'sbx_123'), { host });

    expect(result).toMatchObject({
      success: true,
      data: {
        refreshed: true,
        attached_to_sandbox: 'sbx_123',
        serving_this_session: 'sbx_123',
      },
    });
    expect(result).not.toMatchObject({ data: { attached_to_the_wrong_sandbox: true } });

    const model_visible = (result as { model_visible_data: Record<string, unknown> })
      .model_visible_data;
    expect(model_visible).not.toHaveProperty('attached_to_sandbox');
    expect(model_visible).not.toHaveProperty('serving_this_session');
    expect(JSON.stringify(model_visible)).not.toContain('sbx_123');
  });

  it('refuses to claim success when the rules went to a sandbox this session is not using', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const result = await run(create_context_on_a_live_sandbox(db, 'sbx_replacement'), { host });

    expect(result).toMatchObject({
      success: true,
      data: {
        refreshed: false,
        attached_to_sandbox: 'sbx_123',
        serving_this_session: 'sbx_replacement',
        attached_to_the_wrong_sandbox: true,
      },
    });
    const { message } = (result as { data: { message: string } }).data;
    expect(message).toContain('could not be attached');
    expect(message).not.toContain('Retry your request');

    const model_visible = (result as { model_visible_data: Record<string, unknown> })
      .model_visible_data;
    expect(model_visible).toMatchObject({ attached_to_the_wrong_sandbox: true });
    expect(JSON.stringify(model_visible)).not.toContain('sbx_123');
    expect(JSON.stringify(model_visible)).not.toContain('sbx_replacement');
  });

  it('reports that it could not confirm the sandbox rather than assuming agreement', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const context = create_context_on_a_live_sandbox(db, 'ignored');
    (context.environment as unknown as { exec: () => Promise<never> }).exec = () => {
      throw new Error('sandbox is probably not running anymore');
    };

    const result = await run(context, { host });

    expect(result).toMatchObject({
      success: true,
      data: {
        attached_to_sandbox: 'sbx_123',
        could_not_confirm_sandbox: 'sandbox is probably not running anymore',
      },
    });
    expect(result).not.toMatchObject({ data: { attached_to_the_wrong_sandbox: true } });

    const model_visible = (result as { model_visible_data: Record<string, unknown> })
      .model_visible_data;
    expect(model_visible).not.toHaveProperty('could_not_confirm_sandbox');
    expect(JSON.stringify(model_visible)).not.toContain('not running anymore');
  });

  it('never returns the credential to the agent', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const result = await run(create_context(db), { host });

    expect(JSON.stringify(result)).not.toContain('not-a-real-password');
    expect(JSON.stringify(result)).not.toContain('session=fresh999');
  });

  it('makes zero further requests however many times the agent retries', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ SIGNIN_FAIL: true });

    const context = create_context(db);
    expect(await run(context, { host })).toMatchObject({ data: { refreshed: false } });

    const send_again = stub_vendor({ result: 'success' });
    for (let attempt = 0; attempt < 5; attempt++) await run(context, { host });

    expect(send_again).not.toHaveBeenCalled();
  });

  it("reports the vendor's wait rather than presenting it as a broken tool", async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ PASSWORD_WAIT: 30 });

    const result = await run(create_context(db), { host });

    expect(result).toMatchObject({
      success: true,
      data: { refreshed: false, retry_allowed_after_time: expect.any(String) },
    });
  });

  it('refuses a host this workspace has not connected', async () => {
    const db = await create_test_database();
    await create_credential(db);

    expect(await run(create_context(db), { host: 'api.stripe.com' })).toMatchObject({
      success: false,
      error: { code: 'no_connection_for_host' },
    });
  });

  it('picks the connection that is actually delivering, past dead attempts', async () => {
    const db = await create_test_database();
    await create_credential(db);
    await create_credential(db);
    const live = await create_credential(db);
    await db
      .update(apps)
      .set({
        app_config: {
          add_to_every_request: [
            {
              when_the_request_goes_to: host,
              take_the_value_from: 'from_the_exchange.Cookie',
              encode_the_value_as: 'as_is',
              put_it_in_header: 'Cookie',
              written_as: '{value}',
              worked_out_by: 'login',
            },
          ],
        },
      })
      .where(eq(apps.app_id, live.app_id));
    stub_vendor({ result: 'success' });

    expect(await run(create_context(db), { host })).toMatchObject({
      success: true,
      data: { refreshed: true },
    });
  });

  it('still refuses when two connections are equally good answers', async () => {
    const db = await create_test_database();
    await create_credential(db);
    await create_credential(db);

    expect(await run(create_context(db), { host })).toMatchObject({
      success: false,
      error: { code: 'more_than_one_connection_for_host' },
    });
  });

  it('says plainly when there is no sign-in to repeat', async () => {
    const db = await create_test_database();
    await insert_workspace_credential(db, {
      workspace_id,
      created_by: 'user_1',
      display_name: 'Plain key',
      allowed_hosts: [host],
      secret_values: { api_key: 'k_1' },
    });

    expect(await run(create_context(db), { host })).toMatchObject({
      success: false,
      error: { code: 'connection_cannot_be_refreshed' },
    });
  });

  it('will not renew a connection that was revoked', async () => {
    const db = await create_test_database();
    const created = await create_credential(db);
    await db
      .update(connections)
      .set({ revoked_time: new Date() })
      .where(eq(connections.connection_id, created.connection_id));

    expect(await run(create_context(db), { host })).toMatchObject({
      success: false,
      error: { code: 'no_connection_for_host' },
    });
  });

  it('renews without touching the network when there is no sandbox to update', async () => {
    const db = await create_test_database();
    await create_credential(db);
    stub_vendor({ result: 'success' });

    const result = await run(create_context(db, 'local'), { host });

    expect(result).toMatchObject({ success: true, data: { refreshed: true } });
    expect(update_network).not.toHaveBeenCalled();
  });

  it('re-attaches a credential that has nothing to exchange, without calling out', async () => {
    const db = await create_test_database();
    await insert_workspace_credential(db, {
      workspace_id,
      created_by: 'user_1',
      display_name: 'Plain API key',
      allowed_hosts: ['api.example.com'],
      secret_values: { api_key: 'k_rotated' },
      add_to_every_request: [
        {
          when_the_request_goes_to: 'api.example.com',
          take_the_value_from: 'api_key',
          encode_the_value_as: 'as_is',
          put_it_in_header: 'X-API-Key',
          written_as: '{value}',
          worked_out_by: 'human_override',
        },
      ],
    });
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    const result = await run(create_context(db), { host: 'api.example.com' });

    expect(result).toMatchObject({
      success: true,
      data: { refreshed: true, exchanged: false, hosts_now_authenticated: ['api.example.com'] },
    });
    expect(send).not.toHaveBeenCalled();
    expect(update_network).toHaveBeenCalledWith('sbx_123', {
      rules: { 'api.example.com': [{ transform: { headers: { 'X-API-Key': 'k_rotated' } } }] },
    });
  });

  it('pushes an empty rule set when the connection was revoked after the run began', async () => {
    const db = await create_test_database();
    const created = await create_credential(db);
    stub_vendor({ result: 'success' });
    await run(create_context(db), { host });
    update_network.mockClear();

    await db
      .update(connections)
      .set({ revoked_time: new Date() })
      .where(eq(connections.connection_id, created.connection_id));

    expect(await run(create_context(db), { host })).toMatchObject({
      success: false,
      error: { code: 'no_connection_for_host' },
    });
  });
});
