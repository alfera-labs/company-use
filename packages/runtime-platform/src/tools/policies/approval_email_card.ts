import type { Database } from '@coworker/core';
import { get_user } from '@coworker/core/db/queries/users';
import type { event_jobs } from '@coworker/core/db/schema';
import { create_logger, describe_approval_call } from '@coworker/shared';
import { send_workspace_email } from '@runtime-platform/channels/email/outbound_email';
import {
  read_tool_approval_view,
  type ToolApprovalView,
} from '@runtime-platform/tools/policies/approval_reader_service';
import { describe_the_ask } from '@runtime-platform/tools/policies/approval_slack_cards';

const log = create_logger('approval_email_card');

const approval_reply_instruction = 'Reply YES to approve or NO to refuse.';

type EventJob = typeof event_jobs.$inferSelect;

export async function send_email_approval_card(
  db: Database,
  input: { workspace_id: string; wait: EventJob },
) {
  const view = await read_tool_approval_view(db, input.workspace_id, input.wait);
  if (!view) return 0;

  const to = await read_decider_addresses(db, view.eligible_user_ids);
  if (to.length === 0) return 0;

  await send_workspace_email(db, {
    workspace_id: input.workspace_id,
    session_id: view.session_id,
    to,
    subject: `Approval needed: ${describe_the_ask(view)}`,
    text: build_approval_email_text(view),
    actor_id: 'system:trigger',
  });
  log.info('an approval card was emailed', {
    workspace_id: input.workspace_id,
    job_id: view.job_id,
    recipient_count: to.length,
  });
  return 1;
}

async function read_decider_addresses(db: Database, user_ids: readonly string[]) {
  const users = await Promise.all(user_ids.map((user_id) => get_user(db, user_id)));
  return users.flatMap((user) => (user?.email ? [user.email] : []));
}

function build_approval_email_text(view: ToolApprovalView) {
  const asks = view.calls.map((call) => `I need your OK to ${describe_approval_call(call)}.`);
  const question = view.question ? [view.question, ''] : [];
  return [...question, ...asks, '', approval_reply_instruction, `Approval ${view.job_id}`].join(
    '\n',
  );
}
