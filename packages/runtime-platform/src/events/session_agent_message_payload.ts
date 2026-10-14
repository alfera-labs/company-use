import {
  model_name_schema,
  model_provider_schema,
  model_proxy_schema,
  reasoning_levels,
} from '@coworker/shared';
import { z } from 'zod';

export const session_message_event_source = 'web_chat';
export const session_message_sent_event_type = 'session.message_sent';

const session_message_text_part_schema = z
  .object({ type: z.literal('text'), text: z.string().min(1) })
  .strict();

const session_message_file_part_schema = z
  .object({
    type: z.literal('file'),
    file_id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    url: z.string().url().optional(),
    name: z.string().min(1).max(500).optional(),
    mime_type: z.string().max(120).optional(),
    read_as: z.enum(['image', 'text']).optional(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  })
  .strict()
  .refine((part) => Boolean(part.file_id || part.path || part.url), {
    message: 'A file part names a stored file, a path, or a url.',
  })
  .refine((part) => !part.read_as || Boolean(part.file_id), {
    message: 'Only a stored file can be read as an image or as text.',
  });

export const session_message_part_schema = z.union([
  session_message_text_part_schema,
  session_message_file_part_schema,
]);

export type SessionMessagePart = z.infer<typeof session_message_part_schema>;

export const session_message_payload_schema = z
  .object({
    version: z.literal(1),
    session_id: z.string().min(1),
    actor_user_id: z.string().min(1),
    message: z.string().min(1).optional(),
    content: z.array(session_message_part_schema).min(1).max(60).optional(),
    reasoning_level: z.enum(reasoning_levels).optional(),
    model_provider: model_provider_schema.optional(),
    model_proxy: model_proxy_schema.optional(),
    model_name: model_name_schema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_output_tokens: z.number().int().min(1).max(128_000).optional(),
    client_message_id: z.string().min(1).max(200),
    repeats_run_message_id: z.string().min(1).optional(),
  })
  .strict()
  .refine((payload) => Boolean(payload.message || payload.content?.length), {
    message: 'A message has text or content.',
  });

export type SessionMessagePayload = z.infer<typeof session_message_payload_schema>;

export function session_message_preview_text(payload: SessionMessagePayload) {
  const text =
    payload.message ??
    payload.content?.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(' ') ??
    '';
  return text.trim().slice(0, 200);
}

export function session_message_attachment_count(payload: SessionMessagePayload) {
  return payload.content?.filter((part) => part.type === 'file').length ?? 0;
}
