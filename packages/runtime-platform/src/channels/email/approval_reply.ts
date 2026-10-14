import type { Database } from '@coworker/core';
import { tool_policy_approval_wait_schema } from '@coworker/core/access/tool_policy_approval_schema';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import type { event_jobs } from '@coworker/core/db/schema';
import { create_logger, format_error_message } from '@coworker/shared';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { send_workspace_email } from '@runtime-platform/channels/email/outbound_email';
import { record_the_answer } from '@runtime-platform/tools/policies/answer_from_the_person';

const log = create_logger('email_approval_reply');

type EventJob = typeof event_jobs.$inferSelect;

const decision_by_word = { yes: 'approved', no: 'denied' } as const;

const receipts = {
  approved: 'Approved. Alfera is doing it now.',
  denied: 'Refused. Nothing was sent.',
  not_a_decider: 'You are not able to approve this. It was raised for someone else.',
} as const;

export type ApprovalAnsweredByEmail = {
  job_id: string;
  decision: 'approved' | 'denied' | 'not_a_decider';
};

export async function answer_approval_from_email(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    message: InboundEmailMessage;
    decided_by: string;
  },
): Promise<ApprovalAnsweredByEmail | null> {
  const decision = read_decision_word(input.message.body_text);
  if (!decision) return null;

  const wait = await find_open_wait_for_session(db, input.workspace_id, input.session_id);
  if (!wait) return null;

  if (!read_wait_eligible_user_ids(wait).includes(input.decided_by)) {
    log.warn('an email YES/NO came from someone the question was not raised for', {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      job_id: wait.job_id,
      decided_by: input.decided_by,
    });
    await send_receipt(db, input, 'not_a_decider');
    return { job_id: wait.job_id, decision: 'not_a_decider' };
  }

  const answered = await record_the_answer(db, {
    workspace_id: input.workspace_id,
    job_id: wait.job_id,
    queue_key: wait.awaits_queue_key ?? wait.queue_key,
    decided_by: input.decided_by,
    decision,
    reason: 'email reply',
  });
  if (!answered) return null;

  await send_receipt(db, input, decision);
  return { job_id: wait.job_id, decision };
}

function read_decision_word(body_text: string) {
  const first_line = body_text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('>'));
  const word = first_line?.replace(/[.!…]+$/u, '').toLowerCase();
  return word === 'yes' || word === 'no' ? decision_by_word[word] : null;
}

// A bounded scan of the workspace's open waits, because a question lives 72 hours and a
// workspace holds a handful at a time. Upgrade path when that stops being true: a session-scoped
// query on event_jobs (the session id is inside metadata.policy_approval today).
async function find_open_wait_for_session(
  db: Database,
  workspace_id: string,
  session_id: string,
): Promise<EventJob | null> {
  const waits = await list_tool_policy_waits(db, { workspace_id, status: 'waiting', limit: 200 });
  return waits.find((wait) => read_wait_session_id(wait) === session_id) ?? null;
}

function read_wait_session_id(wait: EventJob) {
  const parsed = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
  return parsed.success ? parsed.data.session_id : null;
}

function read_wait_eligible_user_ids(wait: EventJob): string[] {
  const parsed = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
  return parsed.success ? parsed.data.eligible_user_ids : [];
}

async function send_receipt(
  db: Database,
  input: { workspace_id: string; session_id: string; message: InboundEmailMessage },
  decision: keyof typeof receipts,
) {
  try {
    await send_workspace_email(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      to: [input.message.from_email],
      subject: `Re: ${input.message.subject}`,
      text: receipts[decision],
      actor_id: 'system:trigger',
    });
  } catch (error) {
    log.error('the approval receipt email failed to send', {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      decision,
      error: format_error_message(error),
    });
  }
}
