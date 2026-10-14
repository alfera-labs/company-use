import { to_send_body } from '@api/services/sessions/session_message_not_sent';
import {
  send_session_message,
  sent_message_event_id,
} from '@api/services/sessions/session_message_queue';
import {
  client_message_id_schema,
  create_message_body_schema,
  parse_message_payload,
} from '@api/services/sessions/session_message_request';
import type { Database } from '@coworker/core';
import { find_event_by_source_id } from '@coworker/core/db/queries/events';
import { get_session_message } from '@coworker/core/db/queries/session_read_pages';
import {
  session_message_event_source,
  session_message_payload_schema,
} from '@coworker/runtime-platform';
import { ConflictError, NotFoundError } from '@coworker/shared';
import { z } from 'zod';

export const repeat_queued_message_schema = create_message_body_schema
  .pick({ reasoning_level: true, model_provider: true, model_proxy: true, model_name: true })
  .extend({ client_message_id: client_message_id_schema, run_message_id: z.string().min(1) });

type RepeatSessionMessageInput = {
  workspace_id: string;
  session_id: string;
  user_id: string;
} & z.infer<typeof repeat_queued_message_schema>;

type StoredMessage = NonNullable<Awaited<ReturnType<typeof get_session_message>>>;

/**
 * Runs a message of a chat again. The run reads the stored message, so the chat keeps the one
 * message the person sent and gets a new answer under it. The body is the one the chat queued
 * when it sent the message, with its attachments; a message from another channel gives its text.
 */
export async function repeat_session_message(db: Database, input: RepeatSessionMessageInput) {
  const { client_message_id, run_message_id, workspace_id, session_id, user_id, ...model } = input;
  const message = await get_session_message(db, { workspace_id, session_id, run_message_id });
  if (!message || message.message_role !== 'user' || !message.is_user_visible) {
    throw new NotFoundError('Message');
  }
  const sent_body = await read_sent_body(db, { workspace_id, session_id }, message);
  return send_session_message(db, {
    workspace_id,
    session_id,
    user_id,
    client_message_id,
    body: parse_message_payload({ ...sent_body, ...model }),
    repeats_run_message_id: run_message_id,
  });
}

async function read_sent_body(
  db: Database,
  scope: { workspace_id: string; session_id: string },
  message: StoredMessage,
) {
  const sent_client_message_id = message.source_metadata?.client_message_id;
  const event =
    typeof sent_client_message_id === 'string'
      ? await find_event_by_source_id(db, {
          workspace_id: scope.workspace_id,
          source: session_message_event_source,
          source_event_id: sent_message_event_id({
            session_id: scope.session_id,
            client_message_id: sent_client_message_id,
          }),
        })
      : null;
  const payload = session_message_payload_schema.safeParse(event?.event_body);
  if (payload.success) return to_send_body(payload.data);
  const text = read_stored_text(message);
  if (!text) throw new ConflictError('This message has no text to run again.');
  return { message: text };
}

function read_stored_text(message: StoredMessage) {
  const content = message.message_content;
  const part_text = (content.parts ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
  return (content.text ?? part_text).trim();
}
