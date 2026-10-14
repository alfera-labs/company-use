import {
  id_prefixes,
  is_id,
  model_name_schema,
  model_provider_schema,
  model_proxy_schema,
  normalize_model_route,
  reasoning_levels,
  ValidationError,
} from '@coworker/shared';
import { z } from 'zod';

const request_message_text_part_schema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
});

export const request_message_image_part_schema = z.strictObject({
  type: z.literal('image'),
  data: z.string().min(1),
  mime_type: z.string().min(1).max(120),
  detail: z.enum(['auto', 'low', 'high']).optional(),
  source: z.string().max(500).optional(),
});

const request_message_file_part_schema = z.strictObject({
  type: z.literal('file'),
  file_id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  url: z.string().url().optional(),
  name: z.string().min(1).max(240).optional(),
  mime_type: z.string().max(120).optional(),
  text: z.string().max(50_000).optional(),
  read_as: z.enum(['image', 'text']).optional(),
  detail: z.enum(['auto', 'low', 'high']).optional(),
});

export const request_message_part_schema = z.discriminatedUnion('type', [
  request_message_text_part_schema,
  request_message_image_part_schema,
  request_message_file_part_schema,
]);

export const create_message_body_schema = z.strictObject({
  message: z.string().min(1).optional(),
  content: z.array(request_message_part_schema).min(1).max(40).optional(),
  images: z
    .array(
      request_message_image_part_schema.omit({ type: true }).extend({
        type: z.literal('image').optional(),
      }),
    )
    .max(20)
    .optional(),
  reasoning_level: z.enum(reasoning_levels).optional(),
  model_provider: model_provider_schema.optional(),
  model_proxy: model_proxy_schema.optional(),
  model_name: model_name_schema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().min(1).max(128_000).optional(),
});

export const create_message_schema = create_message_body_schema.transform(normalize_message_body);

export type SessionMessageRequest = z.infer<typeof create_message_schema>;

export const client_message_id_schema = z.string().min(1).max(200);

export const create_queued_message_schema = create_message_body_schema
  .extend({ client_message_id: client_message_id_schema })
  .transform(normalize_message_body);

function normalize_message_body<T extends z.infer<typeof create_message_body_schema>>(
  value: T,
  context: z.RefinementCtx,
) {
  let is_valid = true;
  if (!value.message && !value.content?.length && !value.images?.length) {
    context.addIssue({
      code: 'custom',
      message: 'Request body must include message, content, or images.',
      path: ['message'],
    });
    is_valid = false;
  }
  const read_back_part_index = (value.content ?? []).findIndex(
    (part) =>
      part.type === 'file' &&
      part.read_as &&
      !(part.file_id && is_id(part.file_id, id_prefixes.artifact)),
  );
  if (read_back_part_index !== -1) {
    context.addIssue({
      code: 'custom',
      message: 'read_as needs the file_id of a stored file.',
      path: ['content', read_back_part_index, 'read_as'],
    });
    is_valid = false;
  }

  const normalized_route = normalize_model_route(value);
  if (!normalized_route.success) {
    for (const issue of normalized_route.issues) {
      context.addIssue({ code: 'custom', message: issue.message, path: [issue.field] });
    }
    is_valid = false;
  }
  if (!is_valid || !normalized_route.success) return z.NEVER;
  if (!normalized_route.route) return value;

  return { ...value, ...normalized_route.route };
}

export function parse_message_payload(value: unknown) {
  const parsed = create_message_schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Request body failed validation', parsed.error.flatten());
  }
  return parsed.data;
}
