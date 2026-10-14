import { execute_node } from '@coworker/connectors';
import type { Database, events as events_table } from '@coworker/core';
import { get_workspace_connection_for_connector } from '@coworker/core/db/queries/connectors';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { renew_expired_connector_access_token } from '@runtime-platform/connections/connector_token_refresh';
import { build_connector_connection } from '@runtime-platform/tools/connector_executor';
import { z } from 'zod';

const log = create_logger('connector_batch_job');

const connector_batch_event_body_schema = z
  .object({
    node_key: z.string().min(1),
    input: z.unknown(),
    connection_id: z.string().min(1),
  })
  .strict();

type ConnectorBatchRequest = { node_key: string; input: unknown; connection_id: string };

export async function run_connector_batch_job(input: {
  db: Database;
  workspace_id: string;
  events: (typeof events_table.$inferSelect)[];
}): Promise<EventJobHandlerResult> {
  const requests = read_batch_requests(input.events);
  if (requests.length === 0) {
    return { job_status: 'done', result_data: { skipped_because: 'no_readable_batch_event' } };
  }

  const runs = [];
  for (const request of requests) {
    runs.push(await run_one_connector_batch(input.db, input.workspace_id, request));
  }

  if (runs.every((run) => !run.ok && run.retryable)) {
    return { job_status: 'failed', error_data: { runs } };
  }
  return { job_status: 'done', result_data: { runs } };
}

async function run_one_connector_batch(
  db: Database,
  workspace_id: string,
  request: ConnectorBatchRequest,
) {
  const connection = await renew_expired_connector_access_token(
    db,
    await get_workspace_connection_for_connector(db, {
      workspace_id,
      connection_id: request.connection_id,
    }),
  );
  const connector_connection = connection ? build_connector_connection(connection) : null;
  if (!connector_connection) {
    return {
      ...batch_run_identity(request),
      ok: false,
      retryable: false,
      error_code: 'connection_incomplete',
      error_message: `Connection ${request.connection_id} has no usable credential.`,
    };
  }

  const result = await execute_node(request.node_key, request.input, connector_connection);
  if (result.ok) {
    return { ...batch_run_identity(request), ok: true, retryable: false, data: result.data };
  }

  log.warn('connector batch call failed', {
    workspace_id,
    node_key: request.node_key,
    error_code: result.error.code,
  });
  return {
    ...batch_run_identity(request),
    ok: false,
    retryable: result.error.retryable,
    error_code: result.error.code,
    error_message: result.error.message,
  };
}

function batch_run_identity(request: ConnectorBatchRequest) {
  return { node_key: request.node_key, connection_id: request.connection_id };
}

function read_batch_requests(events: (typeof events_table.$inferSelect)[]) {
  const requests: ConnectorBatchRequest[] = [];
  for (const event of events) {
    const parsed = connector_batch_event_body_schema.safeParse(event.event_body);
    if (!parsed.success) {
      log.error('Unreadable connector batch event body', { event_id: event.event_id });
      continue;
    }
    requests.push(parsed.data);
  }
  return requests;
}
