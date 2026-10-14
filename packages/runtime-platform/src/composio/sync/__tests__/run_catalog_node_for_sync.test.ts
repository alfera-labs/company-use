import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import type { connections } from '@coworker/core/db/schema';
import { find_provider_rate_limit } from '@runtime-platform/composio/sync/provider_rate_limit';
import { create_catalog_sync_node_runner } from '@runtime-platform/composio/sync/run_catalog_node_for_sync';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it } from 'vitest';

const connection = { connection_id: 'conn_sync' } as typeof connections.$inferSelect;

async function create_runner(on_call_made?: () => void) {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  return create_catalog_sync_node_runner(db, {
    workspace_id,
    connection,
    app_name: 'slack',
    on_call_made,
  });
}

describe('create_catalog_sync_node_runner', () => {
  it('refuses a node key the catalog does not hold', async () => {
    const run_node = await create_runner();

    const result = await run_node('demo-list_records-1', {});

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'unknown_node',
        message: 'slack-list_records-1 is not an active node in the catalog.',
        retryable: false,
      },
    });
  });

  it('runs a recipe node under the app name this catalog gave the connection', async () => {
    const run_node = await create_runner();

    const result = await run_node('slack_v2-read_history-1', ['not', 'an', 'object']);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: 'slack-read_history-1 needs an object input.' },
    });
  });

  it('refuses an input that is not an object before it reaches a provider', async () => {
    const run_node = await create_runner();

    const result = await run_node('slack-read_history-1', ['not', 'an', 'object']);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('calls on_call_made once per node call, even when the call is refused', async () => {
    let calls = 0;
    const run_node = await create_runner(() => {
      calls += 1;
    });

    await run_node('demo-list_records-1', {});
    await run_node('slack-read_history-1', ['not', 'an', 'object']);

    expect(calls).toBe(2);
  });
});

describe('find_provider_rate_limit', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  const failure = {
    error_code: 'provider_action_failed',
    status: null,
    retry_after_seconds: null,
    now,
  };

  it('finds a 403 that says the rate limit was exceeded and reads the GitHub reset time', () => {
    const reset = Math.floor(now.getTime() / 1000) + 900;
    const message = `403 API rate limit exceeded; x-ratelimit-reset: ${reset}`;

    expect(find_provider_rate_limit({ ...failure, message })).toEqual({ retry_after_seconds: 900 });
  });

  it('finds a 429 and reads its Retry-After', () => {
    const message = 'Too many requests. Retry-After: 30';

    expect(find_provider_rate_limit({ ...failure, status: 429, message })).toEqual({
      retry_after_seconds: 30,
    });
  });

  it('ignores a 403 that is a permission refusal', () => {
    const message = '403 Resource not accessible by integration';

    expect(find_provider_rate_limit({ ...failure, message })).toBeNull();
  });
});
