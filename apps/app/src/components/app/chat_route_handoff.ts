import { z } from 'zod';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';

const chat_route_handoff_key = 'coworker-chat-route-handoff';
const chat_route_handoff_ttl_ms = 60_000;

export type ChatRouteHandoff = {
  attachments: PendingChatAttachment[];
  message_text: string;
  project_id?: string | null;
};

const message_part_schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mime_type: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
    source: z.string().optional(),
  }),
  z.object({
    type: z.literal('file'),
    file_id: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    name: z.string().optional(),
    mime_type: z.string().optional(),
    text: z.string().optional(),
  }),
]);
const route_handoff_schema = z.object({
  attachments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mime_type: z.string(),
      byte_size: z.number(),
      part: message_part_schema,
    }),
  ),
  created_time: z.number(),
  message_text: z.string(),
  project_id: z.string().nullable().optional(),
});

export function write_chat_route_handoff(input: ChatRouteHandoff) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    chat_route_handoff_key,
    JSON.stringify({
      attachments: input.attachments,
      created_time: Date.now(),
      message_text: input.message_text,
      ...(input.project_id === undefined ? {} : { project_id: input.project_id }),
    }),
  );
}

export function take_chat_route_handoff(): ChatRouteHandoff | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(chat_route_handoff_key);
  window.sessionStorage.removeItem(chat_route_handoff_key);
  if (!raw) return null;

  const parsed = parse_handoff(raw);
  if (!parsed) return null;
  if (Date.now() - parsed.created_time > chat_route_handoff_ttl_ms) return null;

  const attachments: PendingChatAttachment[] = parsed.attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mime_type: attachment.mime_type,
    byte_size: attachment.byte_size,
    upload_status: 'ready',
    upload_progress: 1,
    ...(attachment.part
      ? { part: attachment.part as NonNullable<PendingChatAttachment['part']> }
      : {}),
  }));
  return {
    attachments,
    message_text: parsed.message_text,
    ...(parsed.project_id === undefined ? {} : { project_id: parsed.project_id }),
  };
}

export function peek_chat_route_handoff_text(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(chat_route_handoff_key);
  if (!raw) return null;
  const parsed = parse_handoff(raw);
  if (!parsed) return null;
  if (Date.now() - parsed.created_time > chat_route_handoff_ttl_ms) return null;
  return parsed.message_text.trim() || null;
}

function parse_handoff(raw: string) {
  try {
    return route_handoff_schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
