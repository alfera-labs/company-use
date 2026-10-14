import { ValidationError } from '@coworker/shared';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { z } from 'zod';

export function validate_json<TSchema extends z.ZodType>(schema: TSchema) {
  return zValidator('json', schema, (result) => {
    if (result.success) return;
    throw new ValidationError('Request body failed validation', { issues: result.error.issues });
  });
}

export function validate_query<TSchema extends z.ZodType>(schema: TSchema) {
  return zValidator('query', schema, (result) => {
    if (result.success) return;
    throw new ValidationError('Request query failed validation', { issues: result.error.issues });
  });
}

export async function parse_json_body<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return parse_json_text(await c.req.text(), schema);
}

export function parse_json_text<TSchema extends z.ZodType>(
  text: string,
  schema: TSchema,
): z.output<TSchema> {
  const parsed = schema.safeParse(read_json_text(text));
  if (parsed.success) return parsed.data;
  throw new ValidationError('Request body failed validation', { issues: parsed.error.issues });
}

function read_json_text(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

export function parse_query<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): z.output<TSchema> {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return parsed.data;
  throw new ValidationError('Request query failed validation', { issues: parsed.error.issues });
}
