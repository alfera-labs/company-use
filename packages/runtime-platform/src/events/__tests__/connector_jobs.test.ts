import type { ConnectorResult } from '@coworker/connectors';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { connections } from '@coworker/core/db/schema';
import { connector_health } from '@coworker/core/db/schema/connectors';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.CONNECTOR_CANARY_APPS = 'gmail,made_up_app';
});

const execute_node =
  vi.fn<
    (node_key: string, input: unknown, connection: unknown) => Promise<ConnectorResult<unknown>>
  >();

vi.mock('@coworker/connectors', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/connectors')>();
  return {
    ...actual,
    execute_node: (...args: Parameters<typeof execute_node>) => execute_node(...args),
  };
});

const { seed_connector_catalog } = await import('@coworker/connectors');
const { find_event_job_handler } = await import(
  '@runtime-platform/events/event_job_handler_registry'
);
const { enqueue_daily_connector_canary } = await import(
  '@runtime-platform/events/connector_canary_job'
);

type EventJobRunInput = Parameters<import('@coworker/jobs').EventJobHandler['run']>[0];

type TestDatabase = Awaited<ReturnType<typeof create_test_database>>;

beforeEach(() => {
  execute_node.mockReset();
});

it('runs a queued connector batch through the registry and records what the node answered', async () => {
  const { db, workspace_id } = await connector_job_fixture();
  execute_node.mockResolvedValue({ ok: true, data: { messages: [{ id: 'm_1' }] } });
  const handler = find_event_job_handler('connector_batch');
  if (!handler) throw new Error('connector_batch should be registered');

  const result = await handler.run(
    job_input(db, workspace_id, 'connector_batch:conn_gmail', [
      connector_event({
        node_key: 'gmail-list_messages-1',
        input: { query: 'is:unread' },
        connection_id: 'conn_gmail',
      }),
    ]),
  );

  expect(execute_node).toHaveBeenCalledWith(
    'gmail-list_messages-1',
    { query: 'is:unread' },
    { connection_id: 'conn_gmail', access_token: 'gmail_access_token' },
  );
  expect(result).toMatchObject({
    job_status: 'done',
    result_data: {
      runs: [{ node_key: 'gmail-list_messages-1', connection_id: 'conn_gmail', ok: true }],
    },
  });
});

it('fails a connector batch the provider asked to retry, and never calls a dead connection', async () => {
  const { db, workspace_id } = await connector_job_fixture();
  execute_node.mockResolvedValue({
    ok: false,
    error: { code: 'rate_limited', message: 'Slow down.', retryable: true },
  });
  const handler = find_event_job_handler('connector_batch');
  if (!handler) throw new Error('connector_batch should be registered');

  const retried = await handler.run(
    job_input(db, workspace_id, 'connector_batch:conn_gmail', [
      connector_event({
        node_key: 'gmail-list_messages-1',
        input: {},
        connection_id: 'conn_gmail',
      }),
    ]),
  );
  expect(retried).toMatchObject({
    job_status: 'failed',
    error_data: { runs: [{ ok: false, error_code: 'rate_limited' }] },
  });

  execute_node.mockClear();
  const unknown_connection = await handler.run(
    job_input(db, workspace_id, 'connector_batch:conn_missing', [
      connector_event({
        node_key: 'gmail-list_messages-1',
        input: {},
        connection_id: 'conn_missing',
      }),
    ]),
  );
  expect(execute_node).not.toHaveBeenCalled();
  expect(unknown_connection).toMatchObject({
    job_status: 'done',
    result_data: { runs: [{ ok: false, error_code: 'connection_incomplete' }] },
  });
});

it('sweeps the allow-listed apps through the registry and writes one health row each', async () => {
  const { db } = await connector_job_fixture();
  execute_node.mockResolvedValue({ ok: true, data: { messages: [], next_cursor: null } });
  const handler = find_event_job_handler('connector_canary');
  if (!handler) throw new Error('connector_canary should be registered');

  await handler.run(job_input(db, 'system', 'connector_canary', []));

  const rows = await db.select().from(connector_health);
  const observations = rows.map((row) => ({
    app_key: row.app_key,
    node_key: row.node_key,
    ok: row.ok,
    error_code: row.error_code,
  }));
  expect(observations).toEqual(
    expect.arrayContaining([
      { app_key: 'gmail', node_key: 'gmail-list_messages-1', ok: true, error_code: null },
      { app_key: 'made_up_app', node_key: 'no_probe', ok: false, error_code: 'no_canary_probe' },
    ]),
  );
  expect(rows.every((row) => row.latency_ms >= 0)).toBe(true);
});

it('records the connector failure code when a probe comes back broken', async () => {
  const { db } = await connector_job_fixture();
  execute_node.mockResolvedValue({
    ok: false,
    error: {
      code: 'invalid_provider_response',
      message: 'Gmail changed a field.',
      retryable: false,
    },
  });
  const handler = find_event_job_handler('connector_canary');
  if (!handler) throw new Error('connector_canary should be registered');

  await handler.run(job_input(db, 'system', 'connector_canary', []));

  const rows = await db.select().from(connector_health);
  const gmail_row = rows.find((row) => row.app_key === 'gmail');
  expect(gmail_row).toMatchObject({ ok: false, error_code: 'invalid_provider_response' });
});

it('queues one canary a day however often the recovery tick asks', async () => {
  const { db } = await connector_job_fixture();
  execute_node.mockResolvedValue({ ok: true, data: { messages: [], next_cursor: null } });

  const first = await enqueue_daily_connector_canary(db, new Date('2026-09-05T00:01:00Z'));
  const same_day = await enqueue_daily_connector_canary(db, new Date('2026-09-05T23:59:00Z'));
  const next_day = await enqueue_daily_connector_canary(db, new Date('2026-09-06T00:01:00Z'));

  expect([first.enqueued, same_day.enqueued, next_day.enqueued]).toEqual([true, false, true]);
  const queued = await db.query.event_jobs.findMany({
    where: (table, { eq }) => eq(table.job_handler, 'connector_canary'),
  });
  expect(queued).toHaveLength(2);
});

function job_input(
  db: TestDatabase,
  workspace_id: string,
  queue_key: string,
  events: ReturnType<typeof connector_event>[],
) {
  return {
    db,
    workspace_id,
    queue_key,
    event_jobs: [],
    events,
    heartbeat: async () => undefined,
    record_progress: async () => undefined,
    run_queue_jobs_in_the_background: () => undefined,
    record_started_run_id: async () => undefined,
    signal: new AbortController().signal,
  } as EventJobRunInput;
}

function connector_event(event_body: Record<string, unknown>) {
  return {
    event_id: `event_${Math.random().toString(36).slice(2)}`,
    actor_key: 'user_1',
    event_body,
  } as never;
}

async function connector_job_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_connector_catalog(db);
  const gmail_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'gmail'),
  });
  if (!gmail_app) throw new Error('Gmail connector app was not seeded');

  await db.insert(connections).values({
    connection_id: 'conn_gmail',
    workspace_id: bootstrap.workspace_id,
    app_id: gmail_app.app_id,
    connection_key: 'native:gmail:conn_gmail',
    connection_name: 'Gmail',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:gmail',
    provider_config_version: 1,
    connection_profile_key: 'native:gmail:default',
    connection_profile_version: 1,
    auth_method_key: 'oauth2_authorization_code',
    external_account_id: 'gmail_account_1',
    authorized_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'gmail_access_token' },
    }),
    created_by: 'test',
    last_updated_by: 'test',
  });

  return { db, workspace_id: bootstrap.workspace_id };
}
