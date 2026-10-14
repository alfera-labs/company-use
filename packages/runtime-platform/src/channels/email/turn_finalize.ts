import type { Database } from '@coworker/core';
import {
  claim_run_turn_finalize,
  list_run_messages,
  list_run_tool_calls,
  record_run_turn_finalize_outcome,
} from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import type { TrustedEmailTurnContext } from '@runtime-platform/channels/email/event_payloads';
import {
  record_email_turn_reply,
  send_email_turn_reply,
} from '@runtime-platform/channels/email/turn_reply';
import { z } from 'zod';

const log = create_logger('email_turn_finalize');
const email_reply_tool_name = 'email-respond-1';
const completed_tool_status = 'completed';

const reply_input_schema = z.object({ message: z.string().trim().min(1) }).passthrough();
const assistant_output_metadata_schema = z
  .object({
    provider_metadata: z.object({ stop_reason: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const unresolved_turn_email_text =
  "I finished working on this but couldn't compose a reply. Send your email again and I'll pick it back up.";
const failed_turn_email_text =
  'Something went wrong while working on your email, so no answer was produced. Send it again and I will retry.';

export type EmailTurnFinalizeResult = {
  outcome:
    | 'resolved_by_agent'
    | 'delivered_recovered_reply'
    | 'sent_unresolved_notice'
    | 'sent_run_failure_notice'
    | 'cancelled_without_notice'
    | 'no_reply_expected'
    | 'already_finalized'
    | 'send_failed';
};

export async function finalize_email_channel_turn(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    run_status: string;
    run_error_message?: string | null;
    turn: TrustedEmailTurnContext;
    actor_id: string;
    finalized_by: string;
  },
): Promise<EmailTurnFinalizeResult> {
  const claimed = await claim_run_turn_finalize(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    claimed_by: input.finalized_by,
  });
  if (!claimed) return { outcome: 'already_finalized' };

  const outcome = await deliver_turn_closing_email(db, input);
  await record_run_turn_finalize_outcome(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    outcome: outcome.outcome,
  });
  return outcome;
}

async function deliver_turn_closing_email(
  db: Database,
  input: Parameters<typeof finalize_email_channel_turn>[1],
): Promise<EmailTurnFinalizeResult> {
  const tool_calls = await list_run_tool_calls(db, input.workspace_id, input.run_id);
  if (email_turn_was_resolved(tool_calls)) return { outcome: 'resolved_by_agent' };

  if (input.run_status === 'cancelled') return { outcome: 'cancelled_without_notice' };
  if (input.turn.reply_expected === false) return { outcome: 'no_reply_expected' };
  if (input.run_status !== 'completed') {
    return send_closing_email(db, input, failed_turn_email_text, 'sent_run_failure_notice');
  }

  const run_messages = await list_run_messages(db, input.workspace_id, input.run_id);
  const recovered =
    recover_failed_reply_text(tool_calls) ?? recover_final_assistant_text(run_messages);
  if (recovered) return send_closing_email(db, input, recovered, 'delivered_recovered_reply');
  return send_closing_email(db, input, unresolved_turn_email_text, 'sent_unresolved_notice');
}

export function email_turn_was_resolved(
  tool_calls: Array<{ tool_name: string; tool_status: string }>,
): boolean {
  return tool_calls.some(
    (call) =>
      call.tool_name === email_reply_tool_name && call.tool_status === completed_tool_status,
  );
}

export function recover_failed_reply_text(
  tool_calls: Array<{ tool_name: string; tool_status: string; input_data?: unknown }>,
): string | null {
  const last = tool_calls
    .filter(
      (call) =>
        call.tool_name === email_reply_tool_name && call.tool_status !== completed_tool_status,
    )
    .at(-1);
  const input = reply_input_schema.safeParse(last?.input_data);
  return input.success ? input.data.message : null;
}

export function recover_final_assistant_text(
  run_messages: Array<{
    message_role: string;
    message_kind: string;
    is_user_visible: boolean;
    content_text: string | null;
    source_metadata?: unknown;
  }>,
): string | null {
  const last = run_messages
    .filter(
      (message) =>
        message.message_role === 'assistant' &&
        message.message_kind === 'output' &&
        message.is_user_visible &&
        is_terminal_assistant_output(message.source_metadata) &&
        Boolean(message.content_text?.trim()),
    )
    .at(-1);
  return last?.content_text?.trim() ?? null;
}

function is_terminal_assistant_output(source_metadata: unknown) {
  const metadata = assistant_output_metadata_schema.safeParse(source_metadata);
  const stop_reason = metadata.success ? metadata.data.provider_metadata?.stop_reason : undefined;
  return !stop_reason || stop_reason === 'stop';
}

async function send_closing_email(
  db: Database,
  input: Parameters<typeof finalize_email_channel_turn>[1],
  text: string,
  outcome: Extract<
    EmailTurnFinalizeResult['outcome'],
    'delivered_recovered_reply' | 'sent_unresolved_notice' | 'sent_run_failure_notice'
  >,
): Promise<EmailTurnFinalizeResult> {
  try {
    const sent = await send_email_turn_reply(
      db,
      input.workspace_id,
      input.turn,
      text,
      undefined,
      `email-finalize/${input.run_id}`,
    );
    await record_email_turn_reply(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      email_id: sent.id,
      actor_id: input.actor_id,
    });
    return { outcome };
  } catch (error) {
    log.error('email turn closing message failed to send', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      intended_outcome: outcome,
      error: format_error_message(error),
    });
    return { outcome: 'send_failed' };
  }
}
