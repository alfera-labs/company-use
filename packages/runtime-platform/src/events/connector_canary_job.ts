import { connector_canary_app_keys } from '@coworker/config';
import { execute_node } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import {
  type ConnectorHealthObservation,
  find_first_active_connection_for_app,
  record_connector_health,
} from '@coworker/core/db/queries/connectors';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { renew_expired_connector_access_token } from '@runtime-platform/connections/connector_token_refresh';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { build_connector_connection } from '@runtime-platform/tools/connector_executor';

const connector_canary_job_handler = 'connector_canary';

const log = create_logger('connector_canary_job');

const connector_canary_probes: Record<string, { node_key: string; input: unknown }> = {
  attio: { node_key: 'attio-list_records-1', input: { object: 'companies', limit: 1 } },
  github: { node_key: 'github-search_code-1', input: { query: 'connector canary probe' } },
  gmail: { node_key: 'gmail-list_messages-1', input: {} },
  google_drive: { node_key: 'google_drive-list_files-1', input: { limit: 1 } },
  granola: { node_key: 'granola-list_notes-1', input: { limit: 1 } },
  hubspot: { node_key: 'hubspot-list_records-1', input: { object_type: 'contacts', limit: 1 } },
  notion: { node_key: 'notion-search_pages-1', input: { limit: 1 } },
  salesforce: {
    node_key: 'salesforce-query_records-1',
    input: { soql: 'SELECT Id FROM Account LIMIT 1' },
  },
  slack: { node_key: 'slack-list_channels-1', input: { limit: 1 } },
};

const connector_canary_workspace_id = 'system';

export async function enqueue_daily_connector_canary(db: Database, now: Date = new Date()) {
  const app_keys = connector_canary_app_keys();
  if (app_keys.length === 0) return { enqueued: false, app_keys };

  const today = now.toISOString().slice(0, 10);
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: connector_canary_workspace_id,
      source: 'connector_canary',
      source_event_id: today,
      event_type: 'connector.canary_requested',
      queue_key: 'connector_canary',
      actor_key: 'system:schedule',
      event_body: { canary_date: today },
      event_jobs: [{ job_handler: connector_canary_job_handler }],
    },
    find_event_job_handler,
  );
  return { enqueued: result.event_jobs.length > 0, app_keys };
}

export async function run_connector_canary_job(input: {
  db: Database;
}): Promise<EventJobHandlerResult> {
  const app_keys = connector_canary_app_keys();
  if (app_keys.length === 0) {
    return { job_status: 'done', result_data: { skipped_because: 'no_canary_apps_configured' } };
  }

  const observations: ConnectorHealthObservation[] = [];
  for (const app_key of app_keys) {
    observations.push(await probe_connector_app(input.db, app_key));
  }
  await record_connector_health(input.db, observations);

  const broken = observations.filter((observation) => !observation.ok);
  if (broken.length > 0) {
    log.warn('connector canary found failing apps', {
      apps: broken.map((observation) => `${observation.app_key}:${observation.error_code}`),
    });
  }
  return { job_status: 'done', result_data: { observations } };
}

async function probe_connector_app(
  db: Database,
  app_key: string,
): Promise<ConnectorHealthObservation> {
  const probe = connector_canary_probes[app_key];
  if (!probe) {
    log.error('CONNECTOR_CANARY_APPS names an app with no probe', { app_key });
    return {
      app_key,
      node_key: 'no_probe',
      ok: false,
      latency_ms: 0,
      error_code: 'no_canary_probe',
    };
  }

  const connection = await renew_expired_connector_access_token(
    db,
    await find_first_active_connection_for_app(db, app_key),
  );
  const connector_connection = connection ? build_connector_connection(connection) : null;
  if (!connector_connection) {
    return {
      app_key,
      node_key: probe.node_key,
      ok: false,
      latency_ms: 0,
      error_code: connection ? 'connection_incomplete' : 'no_live_connection',
    };
  }

  const started_at = Date.now();
  const result = await execute_node(probe.node_key, probe.input, connector_connection);
  return {
    app_key,
    node_key: probe.node_key,
    ok: result.ok,
    latency_ms: Date.now() - started_at,
    ...(result.ok ? {} : { error_code: result.error.code }),
  };
}
