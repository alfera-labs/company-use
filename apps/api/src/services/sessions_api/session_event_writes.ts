import { cancel_session_run } from '@api/services/sessions/stop_session_run';
import { api_tool_confirmation_event_label } from '@api/services/sessions_api/public_session_events';
import {
  get_api_session,
  require_owned_api_session,
} from '@api/services/sessions_api/session_reads';
import {
  type PublicTextBlock,
  queue_session_turn,
} from '@api/services/sessions_api/session_service';
import { tool_policy_approval_wait_schema } from '@coworker/core/access/tool_policy_approval_schema';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import {
  get_tool_policy_wait,
  list_sessions_waiting_on_approval,
} from '@coworker/core/db/queries/event_waits';
import { create_run_event, get_tool_call } from '@coworker/core/db/queries/sessions';
import { interrupt_parked_session_runs, record_the_answer } from '@coworker/runtime-platform';
import { AppError, create_id, id_prefixes, NotFoundError, ValidationError } from '@coworker/shared';

export type SendableSessionEvent =
  | { type: 'user.message'; content: PublicTextBlock[] }
  | { type: 'user.interrupt' }
  | {
      type: 'user.tool_confirmation';
      tool_use_id: string;
      result: 'allow' | 'deny';
      deny_message?: string | undefined;
    };

export async function send_api_session_events(
  db: Database,
  api_key: ApiKey,
  session_id: string,
  events: SendableSessionEvent[],
): Promise<{ accepted_event_count: number }> {
  await require_owned_api_session(db, api_key, session_id);

  const turn_content: PublicTextBlock[] = [];
  for (const event of events) {
    if (event.type === 'user.interrupt') await interrupt_api_session(db, api_key, session_id);
    if (event.type === 'user.tool_confirmation') {
      await confirm_api_session_tool_call(db, api_key, session_id, event);
    }
    if (event.type === 'user.message') {
      if (turn_content.length === 0) await assert_session_is_not_running(db, api_key, session_id);
      turn_content.push(...event.content);
    }
  }

  if (turn_content.length > 0) {
    await queue_session_turn(db, {
      api_key,
      session_id,
      user_content: turn_content,
      source_event_id: `${session_id}:${create_id(id_prefixes.event)}`,
    });
  }
  return { accepted_event_count: events.length };
}

async function assert_session_is_not_running(db: Database, api_key: ApiKey, session_id: string) {
  const current = await get_api_session(db, api_key, session_id);
  if (current.status === 'terminated') {
    throw new AppError(
      'session_archived',
      'This session is archived and takes no new events.',
      409,
    );
  }
  if (current.status === 'running') {
    throw new AppError(
      'conversation_busy',
      'This session is still working on the previous message. Interrupt it, or wait for idle.',
      409,
    );
  }
}

async function interrupt_api_session(db: Database, api_key: ApiKey, session_id: string) {
  const session = await require_owned_api_session(db, api_key, session_id);

  const waiting = await list_sessions_waiting_on_approval(db, {
    workspace_id: api_key.workspace_id,
    session_ids: [session_id],
  });
  if (waiting.has(session_id)) {
    await interrupt_parked_session_runs(db, {
      workspace_id: api_key.workspace_id,
      session_id,
      actor_id: api_key.api_key_id,
    });
    return;
  }

  const lock_holds =
    Boolean(session.locked_by_run_id) && (session.lock_expires_time?.getTime() ?? 0) > Date.now();
  if (lock_holds && session.locked_by_run_id) {
    await cancel_session_run(db, {
      workspace_id: api_key.workspace_id,
      run_id: session.locked_by_run_id,
      actor_id: api_key.api_key_id,
    });
  }
}

async function confirm_api_session_tool_call(
  db: Database,
  api_key: ApiKey,
  session_id: string,
  event: Extract<SendableSessionEvent, { type: 'user.tool_confirmation' }>,
) {
  const tool_call = await get_tool_call(db, api_key.workspace_id, event.tool_use_id);
  if (!tool_call || tool_call.session_id !== session_id) throw new NotFoundError('Tool use');

  const job_id = tool_call.tool_call_metadata?.approval_request_id;
  const wait =
    typeof job_id === 'string'
      ? await get_tool_policy_wait(db, { workspace_id: api_key.workspace_id, job_id })
      : null;
  if (!wait || wait.job_status !== 'waiting') {
    throw new AppError(
      'event_not_sendable',
      'That tool use is not waiting for a confirmation.',
      422,
    );
  }
  const approval = tool_policy_approval_wait_schema.parse(wait.metadata.policy_approval);
  if (approval.session_id !== session_id) throw new NotFoundError('Tool use');

  const answered = await record_the_answer(db, {
    workspace_id: api_key.workspace_id,
    job_id: wait.job_id,
    queue_key: wait.awaits_queue_key ?? wait.queue_key,
    decided_by: api_key.api_key_id,
    decision: event.result === 'allow' ? 'approved' : 'denied',
    reason: event.deny_message,
  });
  if (!answered) throw new ValidationError('That tool use was already decided.');

  await record_confirmation_on_the_run(db, api_key, tool_call, event);
}

async function record_confirmation_on_the_run(
  db: Database,
  api_key: ApiKey,
  tool_call: { session_id: string; run_id: string; tool_call_id: string },
  event: Extract<SendableSessionEvent, { type: 'user.tool_confirmation' }>,
) {
  await create_run_event(db, {
    workspace_id: api_key.workspace_id,
    session_id: tool_call.session_id,
    run_id: tool_call.run_id,
    tool_call_id: tool_call.tool_call_id,
    event_type: 'progress',
    event_label: api_tool_confirmation_event_label,
    event_data: { tool_use_id: tool_call.tool_call_id, result: event.result },
    actor_id: api_key.api_key_id,
  });
}
