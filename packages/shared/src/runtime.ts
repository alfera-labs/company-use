import type { JSONSchema7 } from 'json-schema';
import { z } from 'zod';

export const message_text_part_schema = z.object({
  type: z.literal('text'),
  text: z.string(),
  text_signature: z.string().optional(),
  text_signature_data: z.unknown().optional(),
});

export const message_image_part_schema = z.object({
  type: z.literal('image'),
  data: z.string().min(1),
  mime_type: z.string().min(1),
  detail: z.enum(['auto', 'low', 'high']).optional(),
  source: z.string().optional(),
});

export const message_file_part_schema = z.object({
  type: z.literal('file'),
  file_id: z.string().optional(),
  path: z.string().optional(),
  url: z.string().url().optional(),
  name: z.string().optional(),
  mime_type: z.string().optional(),
  text: z.string().optional(),
});

const message_thinking_part_schema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string().optional(),
  signature_data: z.unknown().optional(),
  redacted: z.boolean().optional(),
});

const message_tool_call_part_schema = z.object({
  type: z.literal('tool_call'),
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  thought_signature: z.string().optional(),
});

const message_tool_result_part_schema = z.object({
  type: z.literal('tool_result'),
  tool_call_id: z.string().optional(),
  tool_name: z.string().optional(),
  result: z.unknown(),
});

const message_content_part_schema = z.discriminatedUnion('type', [
  message_text_part_schema,
  message_image_part_schema,
  message_file_part_schema,
  message_thinking_part_schema,
  message_tool_call_part_schema,
  message_tool_result_part_schema,
]);

export const message_content_schema = z.object({
  type: z.enum(['text', 'multimodal', 'event', 'tool_result', 'reasoning_summary']),
  text: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  parts: z.array(message_content_part_schema).optional(),
});

export type MessageContent = z.infer<typeof message_content_schema>;
export type MessageContentPart = z.infer<typeof message_content_part_schema>;

export type RuntimeToolResult =
  | {
      success: true;
      data: unknown;
      model_visible_data?: unknown;
      metadata?: Record<string, unknown>;
      ends_run?: boolean;
      reply_text?: string;
    }
  | {
      success: false;
      error: { code: string; message: string };
      metadata?: Record<string, unknown>;
    };

export type RuntimeToolFailure = Extract<RuntimeToolResult, { success: false }>;

export type JsonSchema = JSONSchema7;
