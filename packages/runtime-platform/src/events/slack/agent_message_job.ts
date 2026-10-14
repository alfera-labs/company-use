import type { Database, event_jobs, events } from '@coworker/core';
import { get_run } from '@coworker/core/db/queries/sessions';
import type { RunMetadataData } from '@coworker/core/db/schema/json_column_types';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import {
  dispatch_slack_channel_event,
  find_active_slack_connection,
} from '@runtime-platform/channels/slack/channel_event_dispatch';
import { remove_slack_processing_reaction } from '@runtime-platform/channels/slack/channel_reactions';
import {
  deduplicate_slack_channel_files,
  read_slack_channel_files,
  type SlackChannelFile,
} from '@runtime-platform/channels/slack/channel_routing';
import { finalize_slack_channel_turn } from '@runtime-platform/channels/slack/turn_finalize';
import { create_slack_web_api } from '@runtime-platform/channels/slack/web_api';
import {
  hold_job_for_credit_top_up,
  job_is_still_waiting_for_credit,
} from '@runtime-platform/events/credit_top_up_hold';
import { slack_discovery_actor_id } from '@runtime-platform/events/slack_discovery_trigger';
import { start_workspace_discovery_run } from '@runtime-platform/events/workspace_discovery_run';
import { type AgentRunJob, read_agent_run_job } from '@runtime-platform/orchestrator/agent_run_job';
import type { StartAgentRunPriorMessage } from '@runtime-platform/orchestrator/runtime_orchestrator';

const log = create_logger('slack_agent_message_job');

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;
type SlackQueuedEventBody = {
  team_id?: string;
  api_app_id?: string;
  channel_id?: string;
  channel_type?: string;
  event_ts?: string;
  thread_ts?: string;
  user_id?: string;
  text?: string;
  mentioned_bot_user_id?: string;
  files?: unknown;
};
type SlackAgentMessageJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_slack_agent_message_job(
  input: SlackAgentMessageJobInput,
): Promise<EventJobHandlerResult> {
  const finished_run_result = await finish_job_for_terminal_run(input);
  if (finished_run_result) return finished_run_result;

  if (await job_is_still_waiting_for_credit(input.db, input)) {
    return hold_job_for_credit_top_up({
      event_jobs: input.event_jobs,
      code: 'out_of_credits',
      message: 'Workspace is out of credits.',
    });
  }

  const slack_events = input.events.flatMap(read_slack_event).sort(compare_slack_events);
  const latest_event = slack_events.at(-1);
  if (!latest_event) return ignored_slack_job_result('No Slack event was available.');

  const prior_events = slack_events.slice(0, -1);
  const prior_messages = prior_events.flatMap((event) =>
    build_slack_prior_message(event.event_record),
  );
  const files = deduplicate_slack_channel_files(
    slack_events.flatMap((event) =>
      read_slack_channel_files(
        (event.event_record.event_body as SlackQueuedEventBody | null)?.files,
      ),
    ),
  );

  const result = await dispatch_slack_event_then_clear_reactions(input.db, {
    latest_event,
    prior_events,
    prior_messages,
    slack_events,
    files,
    job: read_agent_run_job(input),
  });

  if (!result.dispatched) {
    log_undispatched_slack_job(result, input);
    return slack_job_result_for_dispatch_failure(input, result);
  }

  const discovery_started = await start_first_contact_discovery(input);

  return {
    job_status: 'done',
    run_id: result.run_id,
    result_data: {
      dispatched: true,
      session_id: result.session_id,
      run_id: result.run_id,
      channel_id: result.channel_id,
      turn_finalize: result.turn_finalize,
      discovery_started,
    },
  };
}

async function start_first_contact_discovery(input: SlackAgentMessageJobInput) {
  try {
    const discovery = await start_workspace_discovery_run(input.db, {
      workspace_id: input.workspace_id,
      actor_id: slack_discovery_actor_id,
    });
    return discovery.started;
  } catch (error) {
    log.error('starting the Slack workspace sweep from an inbound message failed', {
      workspace_id: input.workspace_id,
      error: format_error_message(error),
    });
    return false;
  }
}

async function finish_job_for_terminal_run(
  input: SlackAgentMessageJobInput,
): Promise<EventJobHandlerResult | null> {
  for (const run_id of read_event_job_run_ids(input.event_jobs)) {
    const run = await get_run(input.db, input.workspace_id, run_id);
    if (!run || !['completed', 'cancelled', 'failed'].includes(run.run_status)) continue;

    const turn_finalize_outcome = await finalize_slack_turn_for_recovered_run(input, run);
    return {
      job_status: 'done',
      run_id,
      result_data: {
        recovered_started_run: true,
        run_status: run.run_status,
        ...(turn_finalize_outcome ? { turn_finalize: turn_finalize_outcome } : {}),
      },
    };
  }

  return null;
}

async function finalize_slack_turn_for_recovered_run(
  input: SlackAgentMessageJobInput,
  run: {
    run_id: string;
    run_status: string;
    error_message: string | null;
    run_metadata: RunMetadataData;
  },
): Promise<string | null> {
  const target = read_slack_turn_target(input.events);
  if (!target) return null;

  try {
    const connection = await find_active_slack_connection(input.db, {
      team_id: target.team_id,
      api_app_id: target.api_app_id,
    });
    if (!connection || connection.workspace_id !== input.workspace_id) return null;

    const slack_api = await create_slack_web_api(
      input.db,
      connection.workspace_id,
      connection.connection_id,
    );
    const turn_stream = run.run_metadata.turn_stream;
    const stream_message_ts = turn_stream?.provider === 'slack' ? turn_stream.message_id : null;
    const result = await finalize_slack_channel_turn(input.db, {
      slack_api,
      workspace_id: input.workspace_id,
      run_id: run.run_id,
      run_status: run.run_status,
      run_error_message: run.error_message,
      channel_id: target.channel_id,
      thread_ts: target.thread_ts,
      ...(stream_message_ts ? { stream_message_ts } : {}),
      actor_id: connection.connected_by ?? connection.last_updated_by,
      finalized_by: 'slack_agent_message_job_recovery',
    });
    return result.outcome;
  } catch (error) {
    log.error('finalizing the Slack turn for a recovered run failed', {
      workspace_id: input.workspace_id,
      run_id: run.run_id,
      queue_key: input.queue_key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function read_slack_turn_target(events: EventRecord[]) {
  const latest_event = events
    .flatMap(read_slack_event)
    .sort(compare_slack_events)
    .at(-1)?.event_record;
  const body = latest_event?.event_body as SlackQueuedEventBody | undefined;
  const team_id = body?.team_id;
  const channel_id = body?.channel_id;
  const event_ts = body?.event_ts;
  if (!team_id || !channel_id || !event_ts) return null;

  return {
    team_id,
    channel_id,
    thread_ts: body?.thread_ts ?? event_ts,
    api_app_id: body?.api_app_id ?? null,
  };
}

async function dispatch_slack_event_then_clear_reactions(
  db: Database,
  input: {
    latest_event: ReturnType<typeof read_slack_event>[number];
    prior_events: Array<ReturnType<typeof read_slack_event>[number]>;
    prior_messages: StartAgentRunPriorMessage[];
    slack_events: Array<ReturnType<typeof read_slack_event>[number]>;
    files: SlackChannelFile[];
    job?: AgentRunJob;
  },
) {
  try {
    return await dispatch_slack_channel_event(db, input.latest_event.verified_event, {
      prior_messages: input.prior_messages,
      known_thread_reply: has_prior_slack_thread_participation(input.prior_events),
      files: input.files,
      ...(input.job ? { job: input.job } : {}),
    });
  } finally {
    await remove_slack_processing_reactions(db, input.slack_events);
  }
}

function read_event_job_run_ids(event_jobs: EventJob[]) {
  return [
    ...new Set(
      event_jobs
        .map((event_job) => event_job.run_id)
        .filter((run_id): run_id is string => typeof run_id === 'string' && run_id.length > 0),
    ),
  ];
}

async function remove_slack_processing_reactions(
  db: Database,
  events: Array<ReturnType<typeof read_slack_event>[number]>,
) {
  for (const event of events) {
    await remove_slack_processing_reaction_for_event(db, event.event_record);
  }
}

async function remove_slack_processing_reaction_for_event(db: Database, event_record: EventRecord) {
  const target = read_slack_reaction_target(event_record);
  if (!target) return;

  const connection = await find_active_slack_connection(db, {
    team_id: target.team_id,
    api_app_id: target.api_app_id,
  });
  if (!connection) return;

  await remove_slack_processing_reaction(connection, {
    channel_id: target.channel_id,
    event_ts: target.event_ts,
  });
}

function read_slack_event(event_record: EventRecord) {
  if (event_record.source !== 'slack') return [];

  return [
    {
      event_record,
      verified_event: {
        channel_provider_key: 'slack',
        provider_event_id: event_record.source_event_id,
        received_time: event_record.created_time,
        raw_event: event_record.raw_payload,
        ...read_optional_slack_event_fields(event_record),
      } satisfies VerifiedChannelEvent,
    },
  ];
}

function compare_slack_events(
  left: ReturnType<typeof read_slack_event>[number],
  right: ReturnType<typeof read_slack_event>[number],
) {
  return (
    slack_event_sort_time(left.event_record) - slack_event_sort_time(right.event_record) ||
    left.event_record.event_id.localeCompare(right.event_record.event_id)
  );
}

function slack_event_sort_time(event_record: EventRecord) {
  const body = event_record.event_body as SlackQueuedEventBody | null;
  const event_ts = body?.event_ts;
  const milliseconds = event_ts ? Number.parseFloat(event_ts) * 1000 : Number.NaN;
  return Number.isFinite(milliseconds) ? milliseconds : event_record.created_time.getTime();
}

function build_slack_prior_message(event_record: EventRecord): StartAgentRunPriorMessage[] {
  const body = event_record.event_body as SlackQueuedEventBody | null;
  const text = body?.text;
  if (!text) return [];

  return [
    {
      message_role: 'user',
      message_content: [{ type: 'text', text }],
      source_type: 'slack',
      source_metadata: {
        slack: {
          event_queue_backfill: true,
          team_id: body?.team_id,
          channel_id: body?.channel_id,
          channel_type: body?.channel_type,
          event_ts: body?.event_ts,
          thread_ts: body?.thread_ts,
          user_id: body?.user_id,
        },
      },
    },
  ];
}

function has_prior_slack_thread_participation(
  events: Array<ReturnType<typeof read_slack_event>[number]>,
) {
  return events.some((event) => {
    const body = event.event_record.event_body as SlackQueuedEventBody | null;
    return Boolean(body?.mentioned_bot_user_id);
  });
}

function read_optional_slack_event_fields(event_record: EventRecord) {
  const body = event_record.event_body as SlackQueuedEventBody | null;
  const team_id = body?.team_id;
  return {
    ...(team_id ? { external_account_id: team_id } : {}),
    ...(event_record.event_type ? { provider_event_type: event_record.event_type } : {}),
  };
}

function read_slack_reaction_target(event_record: EventRecord) {
  const body = event_record.event_body as SlackQueuedEventBody | null;
  const team_id = body?.team_id;
  const channel_id = body?.channel_id;
  const event_ts = body?.event_ts;
  if (!team_id || !channel_id || !event_ts) return null;

  return {
    team_id,
    channel_id,
    event_ts,
    api_app_id: body?.api_app_id ?? null,
  };
}

function slack_job_result_for_dispatch_failure(
  input: SlackAgentMessageJobInput,
  result: Exclude<Awaited<ReturnType<typeof dispatch_slack_channel_event>>, { dispatched: true }>,
): EventJobHandlerResult {
  if (result.code === 'out_of_credits') {
    return hold_job_for_credit_top_up({
      event_jobs: input.event_jobs,
      code: result.code,
      message: result.message,
    });
  }
  if (result.code === 'unsupported_event' || result.code === 'turn_not_authorized') {
    return ignored_slack_job_result(result.message, result.code);
  }

  return {
    job_status: 'failed',
    error_data: {
      code: result.code,
      message: result.message,
    },
  };
}

function ignored_slack_job_result(
  message: string,
  code = 'slack_event_ignored',
): EventJobHandlerResult {
  return {
    job_status: 'done',
    result_data: {
      dispatched: false,
      code,
      message,
    },
  };
}

function log_undispatched_slack_job(
  result: Exclude<Awaited<ReturnType<typeof dispatch_slack_channel_event>>, { dispatched: true }>,
  input: SlackAgentMessageJobInput,
) {
  const benign_codes = ['unsupported_event', 'out_of_credits', 'turn_not_authorized'];
  const emit = benign_codes.includes(result.code) ? log.warn : log.error;
  emit('Slack event was not dispatched', {
    code: result.code,
    message: result.message,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
    job_ids: input.event_jobs.map((job) => job.job_id),
    event_ids: input.events.map((event) => event.event_id),
  });
}
