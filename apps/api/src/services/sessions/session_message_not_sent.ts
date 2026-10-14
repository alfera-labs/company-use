import type { SessionMessageRequest } from '@api/services/sessions/session_message_request';
import { read_repeated_message_id } from '@api/services/sessions/session_message_waiting_reasons';
import { credit_refusal_reasons } from '@coworker/config/billing_words';
import type { Database } from '@coworker/core';
import { list_session_messages_not_sent } from '@coworker/core/db/queries/session_messages_not_sent';
import {
  type SessionMessagePart,
  type SessionMessagePayload,
  session_message_payload_schema,
} from '@coworker/runtime-platform';

export type NotSentReasonCode =
  | 'out_of_credits'
  | 'card_required'
  | 'chat_deleted'
  | 'attachment_unavailable'
  | 'could_not_be_read'
  | 'failed';

const not_sent_reasons: Record<NotSentReasonCode, string> = {
  ...credit_refusal_reasons,
  chat_deleted: 'The chat was deleted',
  attachment_unavailable: 'An attachment is no longer available',
  could_not_be_read: 'The message could not be read',
  failed: 'Sending failed',
};

const reason_code_by_handler_code: Record<string, NotSentReasonCode> = {
  out_of_credits: 'out_of_credits',
  card_required: 'card_required',
  session_unavailable: 'chat_deleted',
  attachment_unavailable: 'attachment_unavailable',
  message_unreadable: 'could_not_be_read',
  message_invalid: 'could_not_be_read',
};

export type NotSentSessionMessage = {
  job_id: string;
  client_message_id: string | null;
  preview_text: string;
  attachment_count: number;
  created_time: Date;
  state: 'not_sent';
  reason_code: NotSentReasonCode;
  reason: string;
  retry_message: SessionMessageRequest | null;
  repeats_run_message_id?: string;
};

type NotSentJob = Awaited<ReturnType<typeof list_session_messages_not_sent>>[number];

export async function describe_session_messages_not_sent(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<NotSentSessionMessage[]> {
  const jobs = await list_session_messages_not_sent(db, input);
  return jobs.map((job) => {
    const reason_code = read_reason_code(job);
    return {
      job_id: job.job_id,
      client_message_id: job.metadata.client_message_id ?? null,
      preview_text: job.metadata.preview_text ?? '',
      attachment_count: job.metadata.attachment_count ?? 0,
      created_time: job.created_time,
      state: 'not_sent',
      reason_code,
      reason: not_sent_reasons[reason_code],
      retry_message: read_retry_message(job),
      ...read_repeated_message_id(job.metadata),
    };
  });
}

function read_reason_code(job: NotSentJob): NotSentReasonCode {
  if (job.job_status !== 'done') return 'failed';
  const code = job.result_data.code;
  return (typeof code === 'string' && reason_code_by_handler_code[code]) || 'failed';
}

function read_retry_message(job: NotSentJob): SessionMessageRequest | null {
  const parsed = session_message_payload_schema.safeParse(job.event_body);
  const would_show_the_message_twice = parsed.data?.repeats_run_message_id !== undefined;
  return parsed.success && !would_show_the_message_twice ? to_send_body(parsed.data) : null;
}

/** The body that sends a queued message again, as the chat sent it the first time. */
export function to_send_body(payload: SessionMessagePayload): SessionMessageRequest {
  const { message, content, reasoning_level, model_provider, model_proxy, model_name } = payload;
  return {
    ...(message === undefined ? {} : { message }),
    ...(content === undefined ? {} : { content: content.map(to_send_part) }),
    ...(reasoning_level === undefined ? {} : { reasoning_level }),
    ...(model_provider === undefined ? {} : { model_provider }),
    ...(model_proxy === undefined ? {} : { model_proxy }),
    ...(model_name === undefined ? {} : { model_name }),
    ...(payload.temperature === undefined ? {} : { temperature: payload.temperature }),
    ...(payload.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: payload.max_output_tokens }),
  };
}

function to_send_part(
  part: SessionMessagePart,
): NonNullable<SessionMessageRequest['content']>[number] {
  if (part.type === 'text') return part;
  return {
    type: 'file',
    ...(part.file_id === undefined ? {} : { file_id: part.file_id }),
    ...(part.path === undefined ? {} : { path: part.path }),
    ...(part.url === undefined ? {} : { url: part.url }),
    ...(part.name === undefined ? {} : { name: part.name.slice(0, 240) }),
    ...(part.mime_type === undefined ? {} : { mime_type: part.mime_type }),
    ...(part.read_as === undefined ? {} : { read_as: part.read_as }),
    ...(part.detail === undefined ? {} : { detail: part.detail }),
  };
}
