import type { Database, event_jobs, events } from '@coworker/core';
import { record_known_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import { get_session_for_user, list_latest_session_runs } from '@coworker/core/db/queries/sessions';
import { get_user } from '@coworker/core/db/queries/users';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { AppError, create_logger, ValidationError } from '@coworker/shared';
import {
  hold_job_for_credit_top_up,
  job_is_still_waiting_for_credit,
} from '@runtime-platform/events/credit_top_up_hold';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import {
  type SessionMessagePayload,
  session_message_event_source,
  session_message_payload_schema,
} from '@runtime-platform/events/session_agent_message_payload';
import { build_session_message_run_input } from '@runtime-platform/events/session_message_run_input';
import {
  message_sender_has_left_the_team,
  sender_left_the_team,
} from '@runtime-platform/events/trigger_member_gate';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { cancel_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';

const log = create_logger('session_agent_message_job');

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;
type SessionRow = NonNullable<Awaited<ReturnType<typeof get_session_for_user>>>;
type UserRow = NonNullable<Awaited<ReturnType<typeof get_user>>>;

type SessionAgentMessageJobInput = {
  db: Database;
  workspace_id: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

const credit_refusal_codes = new Set(['card_required', 'out_of_credits']);

export async function run_session_agent_message_job(
  input: SessionAgentMessageJobInput,
): Promise<EventJobHandlerResult> {
  const finished_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs,
    include_failed_with_final_message: true,
    include_failed_with_progress: true,
  });
  if (finished_run) {
    return { job_status: 'done', run_id: finished_run.run_id, result_data: { reused: true } };
  }

  const payload = read_message_payload(input.events);
  if (!payload) return not_run('message_unreadable', 'The queued message could not be read.');

  const sender = { workspace_id: input.workspace_id, sender_id: payload.actor_user_id };
  if (await message_sender_has_left_the_team(input.db, sender)) return not_run_for_no_sender();
  const [session, still_waiting_for_credit, actor_user] = await Promise.all([
    get_session_for_user(input.db, {
      workspace_id: input.workspace_id,
      session_id: payload.session_id,
      user_id: payload.actor_user_id,
    }),
    job_is_still_waiting_for_credit(input.db, input),
    get_user(input.db, payload.actor_user_id),
  ]);
  if (!session || session.session_status === 'deleted') {
    return not_run('session_unavailable', 'The chat was deleted or is no longer visible.');
  }
  if (still_waiting_for_credit) {
    const held = read_held_refusal(input.event_jobs);
    return hold_for_credit(input, held.code, held.message);
  }

  try {
    return await start_message_run(input, payload, { session, actor_user: actor_user ?? null });
  } catch (error) {
    if (error instanceof AppError && credit_refusal_codes.has(error.code)) {
      return hold_for_credit(input, error.code, error.message);
    }
    if (error instanceof AppError && error.code === 'attachment_unavailable') {
      return not_run(error.code, error.message);
    }
    if (error instanceof ValidationError) return not_run('message_invalid', error.message);
    throw error;
  }
}

async function start_message_run(
  input: SessionAgentMessageJobInput,
  payload: SessionMessagePayload,
  read: { session: SessionRow; actor_user: UserRow | null },
): Promise<EventJobHandlerResult> {
  const [run_input, , speaker] = await Promise.all([
    build_session_message_run_input(input.db, { workspace_id: input.workspace_id, payload }),
    withdraw_run_waiting_on_a_person(input.db, {
      workspace_id: input.workspace_id,
      session_id: payload.session_id,
      actor_id: payload.actor_user_id,
    }),
    record_known_user_as_speaker(input.db, {
      workspace_id: input.workspace_id,
      session_id: payload.session_id,
      user_id: payload.actor_user_id,
      user: read.actor_user ?? undefined,
      read_session: read.session,
    }),
  ]);
  const source_actor = speaker.source_actor;
  const repeats = payload.repeats_run_message_id;
  const is_already_in_the_chat = repeats !== undefined;
  const run = await start_agent_run_for_job(
    input.db,
    {
      workspace_id: input.workspace_id,
      session_id: payload.session_id,
      read_session: speaker.session,
      read_actor_user: read.actor_user,
      ...run_input,
      actor_id: payload.actor_user_id,
      user_message_source_metadata: {
        source_actor,
        client_message_id: payload.client_message_id,
        ...(repeats ? { repeats_run_message_id: repeats } : {}),
      },
      ...(is_already_in_the_chat ? { user_message_is_user_visible: false } : {}),
    },
    read_agent_run_job(input),
  );
  return { job_status: 'done', run_id: run.run_id, result_data: { run_id: run.run_id } };
}

async function withdraw_run_waiting_on_a_person(
  db: Database,
  input: { workspace_id: string; session_id: string; actor_id: string },
) {
  const [latest_run] = await list_latest_session_runs(db, {
    workspace_id: input.workspace_id,
    session_ids: [input.session_id],
  });
  if (latest_run?.run_status !== 'waiting') return;
  await cancel_agent_run(db, {
    workspace_id: input.workspace_id,
    run_id: latest_run.run_id,
    actor_id: input.actor_id,
  });
}

function read_message_payload(records: EventRecord[]): SessionMessagePayload | null {
  const record = records.find((event) => event.source === session_message_event_source);
  if (!record) return null;
  const parsed = session_message_payload_schema.safeParse(record.event_body);
  if (!parsed.success) {
    log.error(`queued message ${record.event_id} has an unusable payload`, parsed.error);
    return null;
  }
  return parsed.data;
}

function read_held_refusal(jobs: EventJob[]) {
  const held = jobs.find((job) => credit_refusal_codes.has(String(job.result_data.code)));
  return {
    code: String(held?.result_data.code ?? 'out_of_credits'),
    message: String(held?.result_data.message ?? 'Workspace is out of credits.'),
  };
}

function hold_for_credit(input: SessionAgentMessageJobInput, code: string, message: string) {
  return hold_job_for_credit_top_up({ event_jobs: input.event_jobs, code, message });
}

function not_run_for_no_sender(): EventJobHandlerResult {
  return not_run(sender_left_the_team.code, sender_left_the_team.message);
}

function not_run(code: string, message: string): EventJobHandlerResult {
  return { job_status: 'done', result_data: { ran: false, code, message } };
}
