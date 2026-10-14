import type { Database } from '@coworker/core';
import { read_workspace_inbound_email_settings } from '@coworker/core/db/queries/workspace_inbound_email_settings';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { create_logger, format_error_message, sleep } from '@coworker/shared';
import { append_email_attribution } from '@runtime-platform/channels/email/attribution';
import type { TrustedEmailTurnContext } from '@runtime-platform/channels/email/event_payloads';
import {
  fetch_sent_email_message_id,
  type SendEmailAttachment,
  send_email_reply,
} from '@runtime-platform/channels/email/resend_api';
import { sent_by_tool_call_tag } from '@runtime-platform/channels/email/sent_email_lookup';
import { record_sent_email_message_id } from '@runtime-platform/channels/email/sent_messages';
import { build_reply_subject } from '@runtime-platform/channels/email/turn_subject';

const log = create_logger('email_turn_reply');

export async function send_email_turn_reply(
  db: Database,
  workspace_id: string,
  turn: TrustedEmailTurnContext,
  text: string,
  attachments?: SendEmailAttachment[],
  idempotency_key?: string,
  tool_call_id?: string,
) {
  const references = build_reply_references(turn);
  const [{ attribution_enabled }, workspace] = await Promise.all([
    read_workspace_inbound_email_settings(db, workspace_id),
    find_workspace_profile(db, workspace_id),
  ]);
  return send_email_reply({
    from: turn.workspace_address,
    to: [turn.reply_to_email],
    cc: turn.reply_cc,
    subject: build_reply_subject(turn.subject),
    text: append_email_attribution(text, attribution_enabled, workspace?.workspace_name),
    ...(attachments?.length ? { attachments } : {}),
    ...(turn.message_id ? { in_reply_to: turn.message_id } : {}),
    ...(references.length ? { references } : {}),
    ...(idempotency_key ? { idempotency_key } : {}),
    ...(tool_call_id ? { tags: [sent_by_tool_call_tag(tool_call_id)] } : {}),
  });
}

const reference_chain_limit = 20;

function build_reply_references(turn: TrustedEmailTurnContext): string[] {
  const chain = [...(turn.references ?? []), ...(turn.message_id ? [turn.message_id] : [])];
  const unique = [...new Set(chain)];
  if (unique.length <= reference_chain_limit) return unique;
  const [root] = unique;
  return [...(root ? [root] : []), ...unique.slice(-(reference_chain_limit - 1))];
}

export async function record_email_turn_reply(
  db: Database,
  input: { workspace_id: string; session_id: string; email_id: string; actor_id: string },
): Promise<void> {
  try {
    const message_id = await read_stamped_message_id(input.email_id);
    if (!message_id) {
      log.warn(
        'the provider had not stamped a Message-ID for this reply; thread continuity for ' +
          'a response quoting it will depend on the sender carrying the wider References chain',
        {
          session_id: input.session_id,
        },
      );
      return;
    }
    await record_sent_email_message_id(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      message_id,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.warn('recording the reply message id failed', {
      session_id: input.session_id,
      error: format_error_message(error),
    });
  }
}

// The provider assigns the RFC 5322 Message-ID while it processes the send, not when it accepts
// it, so reading immediately after the POST returns nothing. Measured against live sends: the id
// is absent at once and present shortly after. These retries run AFTER the reply is already
// delivered, so they cost the run's tail, never the person's wait.
const message_id_retry_delays_ms = [250, 750, 1_500, 3_000];

async function read_stamped_message_id(email_id: string): Promise<string | null> {
  for (const [attempt, delay_ms] of message_id_retry_delays_ms.entries()) {
    const message_id = await fetch_sent_email_message_id(email_id);
    if (message_id) return message_id;
    if (attempt < message_id_retry_delays_ms.length - 1) await sleep(delay_ms);
  }
  return null;
}
