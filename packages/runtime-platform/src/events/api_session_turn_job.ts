import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { Database, event_jobs, events } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import {
  is_billing_refusal,
  record_refused_session_turn,
} from '@runtime-platform/events/api_session_turn_refusal';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import {
  message_sender_has_left_the_team,
  sender_left_the_team,
} from '@runtime-platform/events/trigger_member_gate';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { z } from 'zod';

const log = create_logger('api_session_turn_job');

export const api_session_event_source = 'sessions_api';
export const api_session_turn_event_type = 'session.turn_requested';
export const api_session_turn_job_handler = 'api_session_turn_job';

const api_session_turn_job_body_schema = z
  .object({
    session_turn_payload_version: z.literal(1),
    session_id: z.string().min(1),
    user_content: z.array(z.object({ type: z.literal('text'), text: z.string().min(1) })).min(1),
    api_key_id: z.string().min(1),
  })
  .strict();

export type ApiSessionTurnJobBody = z.infer<typeof api_session_turn_job_body_schema>;

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

type SessionTurnJobInput = {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_api_session_turn_job(
  input: SessionTurnJobInput,
): Promise<EventJobHandlerResult> {
  const turn = read_latest_turn_request(input.events);
  if (!turn) {
    return { job_status: 'done', result_data: { ran: false, code: 'session_turn_skipped' } };
  }

  const finished_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
  });
  if (finished_run) {
    return { job_status: 'done', run_id: finished_run.run_id, result_data: { reused: true } };
  }
  if (await message_sender_has_left_the_team(input.db, { ...input, sender_id: turn.api_key_id })) {
    return { job_status: 'done', result_data: { ran: false, ...sender_left_the_team } };
  }
  return start_the_turn(input, turn);
}

async function start_the_turn(
  input: SessionTurnJobInput,
  turn: ApiSessionTurnJobBody,
): Promise<EventJobHandlerResult> {
  const user_content = turn.user_content as RuntimeAgentMessagePart[];
  let run_was_created = false;
  try {
    const run = await start_agent_run_for_job(
      input.db,
      {
        workspace_id: input.workspace_id,
        session_id: turn.session_id,
        user_content,
        source_type: 'api',
        api_key_id: turn.api_key_id,
        run_metadata: { api_key_id: turn.api_key_id },
        actor_id: turn.api_key_id,
      },
      read_agent_run_job(input),
      {
        on_stream_event: async (event) => {
          if (event.type === 'run_created') run_was_created = true;
        },
      },
    );
    return { job_status: 'done', run_id: run.run_id, result_data: { run_id: run.run_id } };
  } catch (error) {
    if (run_was_created || !is_billing_refusal(error)) throw error;
    return record_refused_session_turn(input.db, {
      workspace_id: input.workspace_id,
      session_id: turn.session_id,
      user_content,
      api_key_id: turn.api_key_id,
      refusal: error,
    });
  }
}

function read_latest_turn_request(records: EventRecord[]): ApiSessionTurnJobBody | null {
  const requests = records
    .filter((record) => record.source === api_session_event_source)
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime());
  const latest = requests.at(-1);
  if (!latest) return null;

  const parsed = api_session_turn_job_body_schema.safeParse(latest.event_body);
  if (!parsed.success) {
    log.error(`session turn ${latest.event_id} has an unusable payload`, parsed.error);
    return null;
  }
  return parsed.data;
}
