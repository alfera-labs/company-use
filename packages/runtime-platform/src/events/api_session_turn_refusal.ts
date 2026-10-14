import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { Database } from '@coworker/core';
import type {} from '@coworker/core/db/queries/events';
import {
  create_run,
  create_run_message,
  get_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { AppError, NotFoundError } from '@coworker/shared';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import { runtime_parts_to_message_content } from '@runtime-platform/orchestrator/runtime_message_content';

const billing_refusal_codes = new Set(['out_of_credits', 'card_required']);

export function is_billing_refusal(error: unknown): error is AppError {
  return error instanceof AppError && billing_refusal_codes.has(error.code);
}

type RefusedTurn = {
  workspace_id: string;
  session_id: string;
  user_content: RuntimeAgentMessagePart[];
  api_key_id: string;
  refusal: AppError;
};

export async function record_refused_session_turn(
  db: Database,
  input: RefusedTurn,
): Promise<EventJobHandlerResult> {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) throw new NotFoundError('Session');

  const run = await create_run(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    agent_id: session.agent_id,
    trigger_type: 'api',
    run_metadata: { api_key_id: input.api_key_id },
    actor_id: input.api_key_id,
  });
  await create_run_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: run.run_id,
    message_role: 'user',
    message_content: runtime_parts_to_message_content(input.user_content),
    source_type: 'api',
    is_model_visible: false,
    actor_id: input.api_key_id,
  });
  await close_the_run_as_refused(db, input, run.run_id);
  // Done, not held for a top-up like an automation fire — the caller was told, and a
  // turn that silently ran hours later would be a second surprise. Resending is the retry.
  return {
    job_status: 'done',
    run_id: run.run_id,
    result_data: { ran: false, code: input.refusal.code },
  };
}

async function close_the_run_as_refused(db: Database, input: RefusedTurn, run_id: string) {
  const source = { source_type: 'runtime_event' as const };
  await record_chat_stream_event_drafts(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id,
    drafts: [
      {
        event_type: 'stream_error',
        error: { code: input.refusal.code, message: input.refusal.message },
        source,
      },
      { event_type: 'run_completed', run_status: 'failed', source },
    ],
    actor_id: input.api_key_id,
  });
  await update_run_status(db, {
    run_id,
    run_status: 'failed',
    error_code: input.refusal.code,
    error_message: input.refusal.message,
    actor_id: input.api_key_id,
  });
}
