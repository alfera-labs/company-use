import { apps, connections, type Database, type event_jobs, type events } from '@coworker/core';
import { pending_connection_setup_expiry_ms } from '@coworker/core/db/queries/connection_management';
import type {} from '@coworker/core/db/queries/events';
import {
  get_run,
  get_session,
  list_runs_by_ids,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import type {
  ConnectionResumeIntentData,
  ConnectionSetupStateData,
} from '@coworker/core/db/schema/json_column_types';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import {
  agent_heartbeat_session_kind,
  ConflictError,
  create_logger,
  format_error_message,
  session_queue_key,
} from '@coworker/shared';
import { start_slack_channel_turn } from '@runtime-platform/channels/slack/channel_turn';
import { read_slack_resume_target } from '@runtime-platform/channels/slack/slack_session_target';
import { find_active_slack_connection_for_workspace_team } from '@runtime-platform/channels/slack/workspace_connection';
import { read_connection_resume_batch_gate } from '@runtime-platform/events/connection_resume_batch_gate';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import {
  type AgentRunJob,
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { and, eq, inArray } from 'drizzle-orm';

const log = create_logger('connection_resume');

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;
type RuntimeSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;

const resume_actor_id = 'system:connection_resume';

export const connection_resume_expiry_ms = 2 * pending_connection_setup_expiry_ms;

type ResumeResolution = 'connected' | 'postponed' | 'cancelled' | 'expired';
type ResumeIntent = ConnectionResumeIntentData & { instruction: string; created_at: string };
type ResumeRequest = {
  connection_id: string;
  resolution: ResumeResolution;
  resume: ConnectionResumeIntentData | undefined;
  created_time: Date;
};

type ParsedResumeRequest = ResumeRequest & {
  intent: ResumeIntent;
};

export async function enqueue_connection_resume(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    actor_id: string;
    setup_state: ConnectionSetupStateData;
    resolution?: ResumeResolution;
  },
) {
  const intent = complete_resume_intent(input.setup_state.resume);
  if (!intent) return { enqueued: false, reason: 'resume_intent_missing' };

  const session = await get_session(db, input.workspace_id, intent.session_id);
  if (!session) {
    return { enqueued: false, reason: 'resume_session_missing' };
  }

  const queue_key = session.external_thread_key ?? session_queue_key(session.session_id);
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: 'connection',
      source_event_id: input.connection_id,
      event_type: 'connection.resume_requested',
      queue_key,
      actor_key: input.actor_id,
      event_body: {
        connection_id: input.connection_id,
        connection_resolution: input.resolution ?? 'connected',
        resume: intent,
      },
      event_jobs: [{ job_handler: 'connection_resume' }],
    },
    find_event_job_handler,
  );

  return {
    enqueued: result.event_jobs.length > 0,
    reason:
      result.event_jobs.length > 0 ? 'connection_resume_enqueued' : 'connection_resume_deduped',
    workspace_id: input.workspace_id,
    queue_key,
    event_jobs: result.event_jobs,
  };
}

export async function run_connection_resume_job(input: {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  now?: Date;
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
}): Promise<EventJobHandlerResult> {
  const now = input.now ?? new Date();
  const requests = read_resume_requests(input.events);
  if (requests.length === 0) return skipped_result('No connection resume event was available.');

  const parsed_requests = parse_resume_requests(requests);
  if (parsed_requests.length === 0) {
    return skipped_result('Connection resume intent was malformed.', 'resume_malformed');
  }

  const recovered = await recovered_started_run_result(input, parsed_requests);
  if (recovered) return recovered;

  const active_requests = unexpired_resume_requests(parsed_requests, {
    workspace_id: input.workspace_id,
    now,
  });
  if (active_requests.length === 0) {
    return skipped_result('Connection resume intent expired.', 'resume_intent_expired');
  }

  const batch_gate = await read_connection_resume_batch_gate(input.db, {
    workspace_id: input.workspace_id,
    batch_ids: [...new Set(active_requests.flatMap((request) => request.intent.batch_id ?? []))],
    now,
  });
  if (batch_gate.retry_at) return waiting_for_origin_run_result(batch_gate.retry_at);
  const ready_requests = active_requests.filter(
    (request) =>
      !request.intent.batch_id || !batch_gate.blocked_batch_ids.has(request.intent.batch_id),
  );
  if (ready_requests.length === 0) {
    return skipped_result(
      'Other connection requests from this task are still waiting.',
      'resume_batch_waiting',
    );
  }

  const intent = ready_requests.at(-1)?.intent;
  if (!intent) return skipped_result('Connection resume intent was malformed.', 'resume_malformed');

  const session = await get_session(input.db, input.workspace_id, intent.session_id);
  if (!session) return skipped_result('Resume session no longer exists.', 'resume_session_missing');

  const pending_requests = await undelivered_resume_requests(input.db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    requests: ready_requests,
  });
  if (pending_requests.length === 0) {
    return skipped_result(
      'An earlier resume already carried these instructions through a finished run.',
      'resume_already_delivered',
    );
  }

  const message_text = resume_message_text(pending_requests);
  const connection_ids = pending_requests
    .filter((request) => request.resolution === 'connected')
    .map((request) => request.connection_id);
  const actor_id = intent.actor_id ?? resume_actor_id;
  const slack = read_slack_resume_target(session);

  try {
    return slack
      ? await resume_in_slack_thread(input.db, {
          workspace_id: input.workspace_id,
          session,
          slack,
          actor_id,
          message_text,
          connection_ids,
          now,
          job: read_agent_run_job(input),
        })
      : await resume_in_chat_session(input.db, {
          workspace_id: input.workspace_id,
          session,
          actor_id,
          message_text,
          connection_ids,
          job: read_agent_run_job(input),
        });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    return failed_result(error);
  }
}

async function recovered_started_run_result(
  input: { db: Database; workspace_id: string; event_jobs?: EventJob[] },
  requests: ParsedResumeRequest[],
): Promise<EventJobHandlerResult | null> {
  const finished_run =
    (await find_finished_event_job_run(input.db, {
      workspace_id: input.workspace_id,
      event_jobs: input.event_jobs ?? [],
      include_failed_with_final_message: true,
    })) ?? (await find_failed_event_job_run(input.db, input.workspace_id, input.event_jobs ?? []));
  if (!finished_run) return null;

  const finished_session = await get_session(input.db, input.workspace_id, finished_run.session_id);
  if (!finished_session) {
    return failed_result(new Error('Finished connection resume session no longer exists.'));
  }

  return {
    job_status: 'done',
    run_id: finished_run.run_id,
    result_data: {
      resumed: true,
      surface: read_slack_resume_target(finished_session) ? 'slack' : 'chat',
      session_id: finished_run.session_id,
      run_id: finished_run.run_id,
      connection_ids: requests.map((request) => request.connection_id),
      recovered_started_run: true,
    },
  };
}

async function undelivered_resume_requests(
  db: Database,
  input: { workspace_id: string; session_id: string; requests: ParsedResumeRequest[] },
) {
  const messages = await list_session_messages(db, input.workspace_id, input.session_id);
  const resume_prompts = messages.filter((message) => message.message_role === 'user');
  const runs = await list_runs_by_ids(
    db,
    input.workspace_id,
    resume_prompts.map((message) => message.run_id),
  );
  const finished_run_ids = new Set(
    runs.filter((run) => run.run_status === 'completed').map((run) => run.run_id),
  );

  return input.requests.filter(
    (request) =>
      !resume_prompts.some(
        (message) =>
          finished_run_ids.has(message.run_id) &&
          message.created_time.getTime() >= new Date(request.intent.created_at).getTime() &&
          is_resume_prompt_for(message.content_text, request.intent.instruction),
      ),
  );
}

async function find_failed_event_job_run(
  db: Database,
  workspace_id: string,
  event_jobs: EventJob[],
) {
  const runs = await Promise.all(
    event_jobs.flatMap((job) => (job.run_id ? [get_run(db, workspace_id, job.run_id)] : [])),
  );
  return runs.find((run) => run?.run_status === 'failed') ?? null;
}

async function resume_in_slack_thread(
  db: Database,
  input: {
    workspace_id: string;
    session: RuntimeSession;
    slack: NonNullable<ReturnType<typeof read_slack_resume_target>>;
    actor_id: string;
    message_text: string;
    connection_ids: string[];
    now: Date;
    job?: AgentRunJob;
  },
): Promise<EventJobHandlerResult> {
  const connection = await find_active_slack_connection_for_workspace_team(db, {
    workspace_id: input.workspace_id,
    team_id: input.slack.team_id,
  });
  if (!connection) {
    return skipped_result(
      'No active Slack connection for the resume Slack team was available.',
      'resume_slack_missing',
    );
  }

  const starting_message = await build_connection_resume_started_message(db, {
    workspace_id: input.workspace_id,
    connection_ids: input.connection_ids,
  });
  const result = await start_slack_channel_turn(db, {
    workspace_id: input.workspace_id,
    agent_id: input.session.agent_id,
    actor_id: input.actor_id,
    connection_id: connection.connection_id,
    message: {
      team_id: input.slack.team_id,
      channel_id: input.slack.channel_id,
      channel_type: input.slack.channel_type,
      event_ts: slack_timestamp(input.now),
      thread_ts: input.slack.thread_ts,
      user_id: input.slack.user_id,
      ...(input.slack.user_profile ? { user_profile: input.slack.user_profile } : {}),
      text: input.message_text,
      raw_text: input.message_text,
    },
    known_thread_reply: true,
    starting_message,
    ...(input.job ? { job: input.job } : {}),
  });

  if (!result.accepted) {
    return skipped_result(result.message, result.code);
  }

  return {
    job_status: 'done',
    run_id: result.run_id,
    result_data: {
      resumed: true,
      surface: 'slack',
      session_id: result.session_id,
      run_id: result.run_id,
      channel_id: input.slack.channel_id,
      connection_ids: input.connection_ids,
      ...(input.slack.thread_ts ? { thread_ts: input.slack.thread_ts } : {}),
    },
  };
}

async function build_connection_resume_started_message(
  db: Database,
  input: { workspace_id: string; connection_ids: string[] },
) {
  const idempotency_key = `connection_resume:${input.workspace_id}:${[...input.connection_ids]
    .sort()
    .join(':')}`;
  try {
    const rows = await db
      .select({ app_name: apps.app_name, connection_name: connections.connection_name })
      .from(connections)
      .leftJoin(apps, eq(connections.app_id, apps.app_id))
      .where(
        and(
          eq(connections.workspace_id, input.workspace_id),
          inArray(connections.connection_id, input.connection_ids),
        ),
      );
    const names = rows.map((row) => row.app_name ?? row.connection_name).filter(Boolean);
    const connection_name = names.length > 0 ? names.join(' and ') : 'Connection';
    return { text: `✅ ${connection_name} connected — on it.`, idempotency_key };
  } catch (error) {
    log.warn('Connection names unavailable for Slack resume acknowledgment', {
      workspace_id: input.workspace_id,
      connection_ids: input.connection_ids,
      error: format_error_message(error),
    });
    return { text: '✅ Connection connected — on it.', idempotency_key };
  }
}

async function resume_in_chat_session(
  db: Database,
  input: {
    workspace_id: string;
    session: RuntimeSession;
    actor_id: string;
    message_text: string;
    connection_ids: string[];
    job?: AgentRunJob;
  },
): Promise<EventJobHandlerResult> {
  const result = await start_agent_run_for_job(
    db,
    {
      workspace_id: input.workspace_id,
      session_id: input.session.session_id,
      user_message: input.message_text,
      user_message_is_user_visible: false,
      ...hidden_session_resume_options(input.session),
      actor_id: input.actor_id,
    },
    input.job,
  );

  return {
    job_status: 'done',
    run_id: result.run_id,
    result_data: {
      resumed: true,
      surface: 'chat',
      session_id: input.session.session_id,
      run_id: result.run_id,
      connection_ids: input.connection_ids,
    },
  };
}

export function hidden_session_resume_options(session: RuntimeSession) {
  const metadata = session.source_metadata;
  const is_heartbeat = metadata?.kind === agent_heartbeat_session_kind;
  const is_hidden = metadata?.runtime_response_is_user_visible === false || is_heartbeat;
  return is_hidden
    ? ({ source_type: 'runtime', runtime_response_is_user_visible: false } as const)
    : {};
}

function complete_resume_intent(
  value: ConnectionResumeIntentData | undefined,
): ResumeIntent | null {
  if (!value?.instruction || !value.created_at) return null;
  return { ...value, instruction: value.instruction, created_at: value.created_at };
}

function parse_resume_requests(requests: ResumeRequest[]): ParsedResumeRequest[] {
  return requests.flatMap((request) => {
    const intent = complete_resume_intent(request.resume);
    return intent ? [{ ...request, intent }] : [];
  });
}

function unexpired_resume_requests(
  requests: ParsedResumeRequest[],
  input: { workspace_id: string; now: Date },
) {
  return requests.filter((request) => {
    if (!is_resume_expired(request.intent.created_at, input.now)) return true;

    log.info('Resume intent expired', {
      workspace_id: input.workspace_id,
      connection_id: request.connection_id,
      session_id: request.intent.session_id,
    });
    return false;
  });
}

function read_resume_requests(events_to_read: EventRecord[]): ResumeRequest[] {
  const requests_by_connection_id = new Map<string, ResumeRequest>();
  for (const event of events_to_read
    .filter((event) => event.source === 'connection')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())) {
    const body = event.event_body;
    const connection_id = body.connection_id;
    if (!connection_id) continue;
    requests_by_connection_id.set(connection_id, {
      connection_id,
      resolution: read_resume_resolution(body.connection_resolution),
      resume: body.resume,
      created_time: event.created_time,
    });
  }

  return Array.from(requests_by_connection_id.values()).sort(
    (left, right) => left.created_time.getTime() - right.created_time.getTime(),
  );
}

function read_resume_resolution(value: string | undefined): ResumeResolution {
  return value === 'postponed' || value === 'cancelled' || value === 'expired'
    ? value
    : 'connected';
}
function is_resume_expired(created_at: string, now: Date) {
  const created_time = new Date(created_at).getTime();
  if (!Number.isFinite(created_time)) return true;
  return now.getTime() - created_time >= connection_resume_expiry_ms;
}

const one_connection_preamble =
  'The connection the user just set up is now active. Continue the task they were waiting on: ';
const many_connections_preamble =
  'The connections the user just set up are now active. Continue the tasks they were waiting on:\n';

function resume_message_text(requests: ParsedResumeRequest[]) {
  const instructions = [...new Set(requests.map((request) => request.intent.instruction))];
  const declined = requests.some((request) => request.resolution !== 'connected');
  if (declined) {
    return `The user's connection choices are resolved. Continue with the connections now available, and do not ask again for connections they postponed, cancelled, or left unfinished: ${instructions.join('\n')}`;
  }
  if (requests.length === 1 && instructions.length === 1) {
    return `${one_connection_preamble}${instructions[0]}`;
  }

  const tasks = instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n');
  return `${many_connections_preamble}${tasks}`;
}

function is_resume_prompt_for(message_text: string | null, instruction: string) {
  if (!message_text?.includes(instruction)) return false;
  return (
    message_text.startsWith(one_connection_preamble) ||
    message_text.startsWith(many_connections_preamble)
  );
}

function slack_timestamp(date: Date) {
  const seconds = Math.floor(date.getTime() / 1000);
  const micros = String((date.getTime() % 1000) * 1000).padStart(6, '0');
  return `${seconds}.${micros}`;
}

function waiting_for_origin_run_result(retry_at: Date): EventJobHandlerResult {
  return {
    job_status: 'failed',
    retry_at,
    retry_counts_as_attempt: false,
    error_data: {
      code: 'resume_batch_still_open',
      message: 'The originating run is still creating connection requests.',
    },
  };
}

function skipped_result(
  message: string,
  code = 'connection_resume_skipped',
): EventJobHandlerResult {
  return { job_status: 'done', result_data: { resumed: false, code, message } };
}

function failed_result(error: unknown): EventJobHandlerResult {
  return {
    job_status: 'failed',
    error_data: {
      code: 'connection_resume_failed',
      message: format_error_message(error, 'Connection resume failed.'),
    },
  };
}
