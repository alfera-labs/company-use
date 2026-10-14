import type { Database, event_jobs, events } from '@coworker/core';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import type { EventJobHandlerResult } from '@coworker/jobs';
import {
  type ChannelSweepJob,
  list_channel_sweep_jobs,
  summarize_channel_sweep,
} from '@runtime-platform/discovery/channel_sweep_results';
import type { SlackDiscoverySummaryEventBody } from '@runtime-platform/events/slack_discovery_event_payload';
import {
  type SlackDiscoveryDeliveryMode,
  slack_discovery_actor_id,
} from '@runtime-platform/events/slack_discovery_trigger';

type EventRecord = Pick<typeof events.$inferSelect, 'event_body'>;
type EventJob = typeof event_jobs.$inferSelect;

type SlackDiscoverySummaryJobInput = {
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

const retry_delay_ms = 30_000;

export async function run_slack_discovery_summary_job(
  input: SlackDiscoverySummaryJobInput,
): Promise<EventJobHandlerResult> {
  const config = read_summary_config(input.events);
  if (!config)
    return failed('discovery_summary_unconfigured', 'Discovery summary is missing config.');

  const child_jobs = await list_channel_sweep_jobs(input.db, {
    workspace_id: input.workspace_id,
    channel_subject_keys: config.channel_subject_keys,
  });
  const pending = child_jobs.filter(
    (job) => job.job_status === 'queued' || job.job_status === 'running',
  );
  if (pending.length > 0) {
    return {
      job_status: 'done',
      retry_at: new Date(Date.now() + retry_delay_ms),
      result_data: { pending_channel_jobs: pending.length },
    };
  }

  const totals = summarize_channel_sweep(child_jobs as ChannelSweepJob[]);
  if (config.delivery_mode === 'silent') {
    return {
      job_status: 'done',
      result_data: {
        ...totals,
        scanned_from: totals.scanned_from?.toISOString() ?? null,
        delivery_mode: 'silent',
        posted_to_slack: false,
      },
    };
  }

  const proposal_queue_key = await enqueue_workflow_proposals(input.db, input.workspace_id, config);
  input.run_queue_jobs_in_the_background({
    workspace_id: input.workspace_id,
    queue_key: proposal_queue_key,
  });
  return {
    job_status: 'done',
    result_data: {
      ...totals,
      scanned_from: totals.scanned_from?.toISOString() ?? null,
      delivery_mode: 'slack',
      posted_to_slack: false,
      notification_channel_id: config.channel_id,
    },
  };
}

async function enqueue_workflow_proposals(
  db: Database,
  workspace_id: string,
  config: SlackSummaryConfig,
) {
  const run_key = config.discovery_run_key ?? 'default';
  const queue_key = `slack_workflow_proposal:${workspace_id}:${run_key}`;
  await enqueue_event_jobs(db, {
    workspace_id,
    source: 'slack_discovery',
    source_event_id: `${workspace_id}:proposals:${run_key}`,
    event_type: 'slack.workflow_proposals',
    queue_key,
    actor_key: slack_discovery_actor_id,
    event_body: {
      workspace_id,
      connection_id: config.connection_id,
      notification_channel_id: config.channel_id,
      discovery_run_key: run_key,
      channel_subject_keys: config.channel_subject_keys,
    },
    event_jobs: [{ job_handler: 'slack_workflow_proposal' }],
  });
  return queue_key;
}

type SummaryConfigBase = {
  connection_id: string;
  channel_subject_keys: string[];
  discovery_run_key?: string;
};

type SlackSummaryConfig = SummaryConfigBase & { delivery_mode: 'slack'; channel_id: string };
type SummaryConfig = (SummaryConfigBase & { delivery_mode: 'silent' }) | SlackSummaryConfig;

function read_summary_config(events: EventRecord[]): SummaryConfig | null {
  const body = events.at(-1)?.event_body as SlackDiscoverySummaryEventBody | undefined;
  if (!body?.connection_id) return null;
  const channel_id = body.notification_channel_id ?? null;
  const base = {
    connection_id: body.connection_id,
    channel_subject_keys: body.channel_subject_keys ?? [],
    ...(body.discovery_run_key ? { discovery_run_key: body.discovery_run_key } : {}),
  };
  const delivery_mode = read_delivery_mode(body?.delivery_mode, channel_id);
  if (delivery_mode === 'silent') return { ...base, delivery_mode };
  return channel_id ? { ...base, delivery_mode, channel_id } : null;
}

function read_delivery_mode(
  value: unknown,
  legacy_channel_id: string | null,
): SlackDiscoveryDeliveryMode {
  if (value === 'silent') return 'silent';
  return legacy_channel_id ? 'slack' : 'silent';
}

function failed(code: string, message: string): EventJobHandlerResult {
  return { job_status: 'failed', error_data: { code, message } };
}
