import type { Database } from '@coworker/core';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

const discovery_queue_prefix = 'slack_discovery';

export type SlackDiscoveryNotification = {
  connection_id: string;
  channel_id: string;
  channel_name?: string | null;
};

export type SlackDiscoveryDeliveryMode = 'silent' | 'slack';

export function workspace_slack_discovery_queue_key(
  workspace_id: string,
  discovery_run_key?: string,
) {
  return discovery_run_key
    ? `${discovery_queue_prefix}:${workspace_id}:${discovery_run_key}`
    : `${discovery_queue_prefix}:${workspace_id}`;
}

export async function start_workspace_slack_discovery(
  db: Database,
  input: {
    workspace_id: string;
    connection_id?: string;
    discovery_run_key?: string;
    notification?: SlackDiscoveryNotification;
  },
) {
  const delivery_mode: SlackDiscoveryDeliveryMode = input.notification ? 'slack' : 'silent';
  return queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: 'slack_discovery',
      source_event_id: discovery_source_event_id(input),
      event_type: 'slack.discover_workspace',
      queue_key: workspace_slack_discovery_queue_key(input.workspace_id, input.discovery_run_key),
      actor_key: slack_discovery_actor_id,
      event_body: {
        workspace_id: input.workspace_id,
        ...(input.connection_id ? { connection_id: input.connection_id } : {}),
        ...(input.discovery_run_key ? { discovery_run_key: input.discovery_run_key } : {}),
        delivery_mode,
        ...(input.notification ? { notification: input.notification } : {}),
      },
      event_jobs: [{ job_handler: 'slack_discovery' }],
    },
    find_event_job_handler,
  );
}

export const slack_discovery_actor_id = 'system:discovery';

function discovery_source_event_id(input: { workspace_id: string; discovery_run_key?: string }) {
  return input.discovery_run_key
    ? `${input.workspace_id}:discover_workspace:${input.discovery_run_key}`
    : `${input.workspace_id}:discover_workspace`;
}
