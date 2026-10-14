import type { Database, event_jobs, events } from '@coworker/core';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { load_slack_user_directory } from '@runtime-platform/channels/slack/directory';
import {
  find_workspace_slack_connection,
  list_all_workspace_slack_channels,
  read_slack_bot_token,
  type SlackChannelSummary,
} from '@runtime-platform/channels/slack/history';
import type { SlackDiscoveryEventBody } from '@runtime-platform/events/slack_discovery_event_payload';
import {
  type SlackDiscoveryDeliveryMode,
  type SlackDiscoveryNotification,
  slack_discovery_actor_id,
} from '@runtime-platform/events/slack_discovery_trigger';

type EventRecord = Pick<typeof events.$inferSelect, 'event_body'>;
type EventJob = typeof event_jobs.$inferSelect;

type SlackDiscoveryJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  heartbeat: () => Promise<void>;
  run_queue_jobs_in_the_background: (input: {
    workspace_id: string;
    queue_key: string;
    delay_ms?: number;
  }) => void;
};

type DiscoveryContext = ReturnType<typeof read_discovery_context>;

type SlackDiscoveryConnection = {
  connection_id: string;
  token: string;
  team_id: string;
};

const log = create_logger('slack_discovery');
const heartbeat_every_channels = 50;
const summary_delay_ms = 30_000;

export function channel_discovery_queue_key(channel_id: string, discovery_run_key?: string) {
  return discovery_run_key
    ? `slack_discovery_channel:${discovery_run_key}:${channel_id}`
    : `slack_discovery_channel:${channel_id}`;
}

export async function run_slack_discovery_job(
  input: SlackDiscoveryJobInput,
): Promise<EventJobHandlerResult> {
  const discovery = read_discovery_context(input.events);
  const slack_connection = await find_slack_discovery_connection(
    input.db,
    input.workspace_id,
    discovery.connection_id,
  );
  if (!slack_connection) {
    return discovery_failed(
      'no_active_slack_connection',
      'Workspace has no active Slack bot connection.',
    );
  }

  const member_count = await count_workspace_members(slack_connection);
  const channels = await list_readable_slack_channels(slack_connection.token);
  const channel_subject_keys = await enqueue_channel_discovery_jobs(
    input,
    discovery,
    slack_connection.connection_id,
    channels,
  );
  await enqueue_summary_job(input.db, {
    workspace_id: input.workspace_id,
    connection_id: slack_connection.connection_id,
    delivery_mode: discovery.delivery_mode,
    ...(discovery.notification ? { notification: discovery.notification } : {}),
    ...(discovery.run_key ? { discovery_run_key: discovery.run_key } : {}),
    channel_subject_keys,
    member_count,
  });

  return {
    job_status: 'done',
    result_data: {
      channels_enqueued: channels.length,
      member_count,
      discovery_run_key: discovery.run_key,
    },
  };
}

async function count_workspace_members(connection: SlackDiscoveryConnection): Promise<number> {
  try {
    const directory = await load_slack_user_directory(connection.token);
    return directory.members.filter((member) => !member.is_bot).length;
  } catch (error) {
    log.error('member count lookup failed', { error: format_error_message(error) });
    return 0;
  }
}

async function find_slack_discovery_connection(
  db: Database,
  workspace_id: string,
  connection_id?: string,
): Promise<SlackDiscoveryConnection | null> {
  const connection = await find_workspace_slack_connection(db, workspace_id, connection_id);
  const token = connection ? read_slack_bot_token(connection.credentials) : null;
  return connection && token && connection.external_account_id
    ? { connection_id: connection.connection_id, token, team_id: connection.external_account_id }
    : null;
}

async function list_readable_slack_channels(token: string) {
  const channels = await list_all_workspace_slack_channels(token);
  return channels.filter((channel) => channel.is_member !== false);
}

async function enqueue_channel_discovery_jobs(
  input: SlackDiscoveryJobInput,
  discovery: DiscoveryContext,
  connection_id: string,
  channels: SlackChannelSummary[],
) {
  const channel_subject_keys: string[] = [];
  let processed = 0;
  for (const channel of channels) {
    const queue_key = channel_discovery_queue_key(channel.channel_id, discovery.run_key);
    channel_subject_keys.push(queue_key);
    await enqueue_channel_discovery_job(input.db, {
      workspace_id: input.workspace_id,
      connection_id,
      channel,
      queue_key,
      ...(discovery.run_key ? { discovery_run_key: discovery.run_key } : {}),
    });
    input.run_queue_jobs_in_the_background({ workspace_id: input.workspace_id, queue_key });
    processed += 1;
    if (processed % heartbeat_every_channels === 0) await input.heartbeat();
  }
  return channel_subject_keys;
}

async function enqueue_channel_discovery_job(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    channel: SlackChannelSummary;
    queue_key: string;
    discovery_run_key?: string;
  },
) {
  return enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: 'slack_discovery',
    source_event_id: channel_source_event_id(input),
    event_type: 'slack.discover_channel',
    queue_key: input.queue_key,
    actor_key: slack_discovery_actor_id,
    event_body: {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      channel_id: input.channel.channel_id,
      channel_name: input.channel.channel_name,
      ...(input.discovery_run_key ? { discovery_run_key: input.discovery_run_key } : {}),
    },
    event_jobs: [{ job_handler: 'slack_discovery_channel' }],
  });
}

async function enqueue_summary_job(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    delivery_mode: SlackDiscoveryDeliveryMode;
    discovery_run_key?: string;
    notification?: SlackDiscoveryNotification;
    channel_subject_keys: string[];
    member_count: number;
  },
) {
  const source_event_id = input.discovery_run_key
    ? `${input.workspace_id}:summary:${input.discovery_run_key}`
    : `${input.workspace_id}:summary`;
  const queue_key = input.discovery_run_key
    ? `slack_discovery:${input.workspace_id}:${input.discovery_run_key}`
    : `slack_discovery:${input.workspace_id}`;
  return enqueue_event_jobs(db, {
    workspace_id: input.workspace_id,
    source: 'slack_discovery',
    source_event_id,
    event_type: 'slack.discovery_summary',
    queue_key,
    actor_key: slack_discovery_actor_id,
    event_body: {
      workspace_id: input.workspace_id,
      discovery_run_key: input.discovery_run_key,
      connection_id: input.connection_id,
      delivery_mode: input.delivery_mode,
      member_count: input.member_count,
      ...(input.notification
        ? {
            notification_channel_id: input.notification.channel_id,
            notification_channel_name: input.notification.channel_name,
          }
        : {}),
      channel_subject_keys: input.channel_subject_keys,
    },
    event_jobs: [
      {
        job_handler: 'slack_discovery_summary',
        available_time: new Date(Date.now() + summary_delay_ms),
      },
    ],
  });
}

function read_discovery_context(events: EventRecord[]) {
  const body = events.at(-1)?.event_body as SlackDiscoveryEventBody | undefined;
  const notification = body?.notification;
  return {
    connection_id: body?.connection_id,
    run_key: body?.discovery_run_key,
    delivery_mode: read_delivery_mode(body?.delivery_mode, notification),
    notification,
  };
}

function read_delivery_mode(
  value: unknown,
  notification: SlackDiscoveryNotification | undefined,
): SlackDiscoveryDeliveryMode {
  if (value === 'silent') return 'silent';
  return notification ? 'slack' : 'silent';
}

function channel_source_event_id(input: {
  workspace_id: string;
  channel: SlackChannelSummary;
  discovery_run_key?: string;
}) {
  return input.discovery_run_key
    ? `${input.workspace_id}:channel:${input.discovery_run_key}:${input.channel.channel_id}`
    : `${input.workspace_id}:channel:${input.channel.channel_id}`;
}

function discovery_failed(code: string, message: string): EventJobHandlerResult {
  return { job_status: 'failed', error_data: { code, message } };
}
