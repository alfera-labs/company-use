import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  count_api_key_request_in_window,
  create_api_key,
  find_live_api_key_by_secret,
  list_workspace_api_keys,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { api_keys } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('api key credential lifecycle', () => {
  it('mints a key whose secret authenticates and is never stored', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const { api_key, secret } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'Northwind production',
      scopes: ['memory.read'],
      key_audience: 'external',
      environment_label: 'test',
      actor_id: bootstrap.user_id,
    });

    expect(secret.startsWith('ak_test_')).toBe(true);
    expect(api_key.key_prefix).toBe(secret.slice(0, 12));
    expect(JSON.stringify(api_key)).not.toContain(secret.slice(12));

    const found = await find_live_api_key_by_secret(db, secret);
    expect(found.api_key_id).toBe(api_key.api_key_id);
    expect(found.workspace_id).toBe(bootstrap.workspace_id);
    expect(found.scopes).toEqual(['memory.read']);
    expect(found.key_audience).toBe('external');
  });

  it('rejects an unknown secret with api_key_invalid', async () => {
    const db = await create_test_database();
    await expect(
      find_live_api_key_by_secret(db, 'ak_test_not_a_real_secret'),
    ).rejects.toMatchObject({ code: 'api_key_invalid', status: 401 });
  });

  it('rejects a revoked key with api_key_revoked', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const { api_key, secret } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'to revoke',
      scopes: ['answers.write'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: bootstrap.user_id,
    });

    const revoked = await revoke_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      api_key_id: api_key.api_key_id,
      actor_id: bootstrap.user_id,
    });
    expect(revoked?.key_status).toBe('revoked');
    expect(revoked?.revoked_time).toBeInstanceOf(Date);

    await expect(find_live_api_key_by_secret(db, secret)).rejects.toMatchObject({
      code: 'api_key_revoked',
      status: 401,
    });
  });

  it('rejects an expired key with api_key_expired', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const { secret } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'already expired',
      scopes: ['memory.read'],
      key_audience: 'internal',
      environment_label: 'test',
      expires_time: new Date(Date.now() - 1000),
      actor_id: bootstrap.user_id,
    });

    await expect(find_live_api_key_by_secret(db, secret)).rejects.toMatchObject({
      code: 'api_key_expired',
      status: 401,
    });
  });

  it('cannot revoke a key belonging to another workspace', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const { api_key } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'mine',
      scopes: ['memory.read'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: bootstrap.user_id,
    });

    const stolen = await revoke_api_key(db, {
      workspace_id: 'ws_someone_else',
      api_key_id: api_key.api_key_id,
      actor_id: 'user_intruder',
    });
    expect(stolen).toBeNull();

    const [listed] = await list_workspace_api_keys(db, bootstrap.workspace_id);
    expect(listed?.key_status).toBe('active');
  });

  it('counts requests per fixed window and trips the limit', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const { api_key } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'rate limited',
      scopes: ['memory.read'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: bootstrap.user_id,
    });

    const first = await count_api_key_request_in_window(db, {
      api_key_id: api_key.api_key_id,
      window_ms: 60_000,
      request_limit: 2,
    });
    const second = await count_api_key_request_in_window(db, {
      api_key_id: api_key.api_key_id,
      window_ms: 60_000,
      request_limit: 2,
    });
    const third = await count_api_key_request_in_window(db, {
      api_key_id: api_key.api_key_id,
      window_ms: 60_000,
      request_limit: 2,
    });

    expect(first).toEqual({ allowed: true, request_count: 1 });
    expect(second).toEqual({ allowed: true, request_count: 2 });
    expect(third.allowed).toBe(false);
    expect(third.request_count).toBe(3);

    const [listed] = await list_workspace_api_keys(db, bootstrap.workspace_id);
    expect(listed?.last_used_time).toBeInstanceOf(Date);
  });

  it('starts a fresh count when the stored window is older than the current one', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const { api_key } = await create_api_key(db, {
      workspace_id: bootstrap.workspace_id,
      key_name: 'window roller',
      scopes: ['memory.read'],
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: bootstrap.user_id,
    });
    const charge_one_request = () =>
      count_api_key_request_in_window(db, {
        api_key_id: api_key.api_key_id,
        window_ms: 60_000,
        request_limit: 2,
      });

    await charge_one_request();
    await charge_one_request();
    await db
      .update(api_keys)
      .set({ rate_window_start_time: new Date(Date.now() - 5 * 60_000) })
      .where(eq(api_keys.api_key_id, api_key.api_key_id));

    expect(await charge_one_request()).toEqual({ allowed: true, request_count: 1 });
  });
});
