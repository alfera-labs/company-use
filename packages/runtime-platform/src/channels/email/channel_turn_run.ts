import { env } from '@coworker/config';
import { out_of_credit_sentence } from '@coworker/config/billing_words';
import type { Database } from '@coworker/core';
import { AppError, create_logger, format_error_message } from '@coworker/shared';
import {
  create_email_attachment_sources,
  read_email_attachments,
} from '@runtime-platform/channels/email/attachment_sources';
import type {
  StartEmailChannelTurnInput,
  StartEmailChannelTurnResult,
} from '@runtime-platform/channels/email/channel_turn';
import { email_message_text } from '@runtime-platform/channels/email/message_format';
import type { find_or_create_email_thread_session } from '@runtime-platform/channels/email/thread_sessions';
import { finalize_email_channel_turn } from '@runtime-platform/channels/email/turn_finalize';
import type {
  build_email_source_actor,
  build_email_turn_metadata,
} from '@runtime-platform/channels/email/turn_metadata';
import { send_email_turn_reply } from '@runtime-platform/channels/email/turn_reply';
import { start_agent_run_for_job } from '@runtime-platform/orchestrator/agent_run_job';

const log = create_logger('email_channel_turn');

export const email_actor_id = 'system:email';

export type OpenedEmailTurn = {
  thread: Awaited<ReturnType<typeof find_or_create_email_thread_session>>;
  turn: ReturnType<typeof build_email_turn_metadata> & { sender_is_workspace_member: boolean };
  source_actor: ReturnType<typeof build_email_source_actor>;
};

const email_billing_refusals = {
  out_of_credits: {
    text: out_of_credit_sentence(env.APP_UPGRADE_URL),
    notice_key: 'email-out-of-credits',
  },
} as const;

type EmailBillingRefusal = keyof typeof email_billing_refusals;

function billing_refusal_code(error: unknown): EmailBillingRefusal | null {
  if (!(error instanceof AppError)) return null;
  return error.code in email_billing_refusals ? (error.code as EmailBillingRefusal) : null;
}

export async function run_the_email_turn(
  db: Database,
  input: StartEmailChannelTurnInput,
  opened: OpenedEmailTurn,
): Promise<StartEmailChannelTurnResult> {
  const { thread, turn } = opened;
  const run = await start_the_email_run(db, input, opened);
  if ('billing_refusal' in run) {
    await reply_that_billing_stopped(db, input.workspace_id, thread.session_id, turn, {
      code: run.billing_refusal,
      ...email_billing_refusals[run.billing_refusal],
    });
    return {
      accepted: false,
      code: run.billing_refusal,
      message: `Email turn refused by billing: ${run.billing_refusal}.`,
    };
  }

  const turn_finalize = await finalize_email_channel_turn(db, {
    workspace_id: input.workspace_id,
    session_id: thread.session_id,
    run_id: run.run_id,
    run_status: run.run_status,
    run_error_message: run.error_message,
    turn,
    actor_id: email_actor_id,
    finalized_by: 'email_channel_turn',
  });
  log.info('email turn finished', {
    workspace_id: input.workspace_id,
    session_id: thread.session_id,
    run_id: run.run_id,
    turn_finalize: turn_finalize.outcome,
  });

  return { accepted: true, session_id: thread.session_id, run_id: run.run_id, turn_finalize };
}

async function start_the_email_run(
  db: Database,
  input: StartEmailChannelTurnInput,
  { thread, turn, source_actor }: OpenedEmailTurn,
) {
  const attachment_sources = await create_email_attachment_sources(
    input.message.email_id,
    await read_email_attachments(input.message.email_id),
  );
  return start_agent_run_for_job(
    db,
    {
      workspace_id: input.workspace_id,
      session_id: thread.session_id,
      user_message: email_message_text(input.message, {
        sender_is_workspace_member: turn.sender_is_workspace_member,
        answers_agent_question: thread.session_source !== 'email',
      }),
      attachment_sources,
      source_type: 'email',
      user_message_source_metadata: { source_actor, email: turn },
      actor_id: email_actor_id,
    },
    input.job,
  ).catch((error: unknown) => {
    const refusal = billing_refusal_code(error);
    if (refusal) return { billing_refusal: refusal };
    throw error;
  });
}

async function reply_that_billing_stopped(
  db: Database,
  workspace_id: string,
  session_id: string,
  turn: Parameters<typeof send_email_turn_reply>[2] & { sender_is_workspace_member: boolean },
  refusal: { code: EmailBillingRefusal; text: string; notice_key: string },
) {
  if (!turn.sender_is_workspace_member) return;
  try {
    await send_email_turn_reply(
      db,
      workspace_id,
      turn,
      refusal.text,
      undefined,
      `${refusal.notice_key}/${session_id}`,
    );
  } catch (error) {
    log.error('billing-refusal email notice failed to send', {
      workspace_id,
      session_id,
      refusal: refusal.code,
      error: format_error_message(error),
    });
  }
}
