import type { Database } from '@coworker/core/db/connection';
import type { ApiKey, ApiKeyScope } from '@coworker/core/db/queries/api_keys';
import { ValidationError } from '@coworker/shared';
import { z } from 'zod';

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
};

export type BrainTool = {
  title: string;
  description: string;
  annotations: McpToolAnnotations;
  required_scope: ApiKeyScope | null;
  json_schema: unknown;
  run: (
    db: Database,
    api_key: ApiKey,
    raw_arguments: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
};

export function define_brain_tool<TSchema extends z.ZodType>(tool: {
  title: string;
  description: string;
  annotations: McpToolAnnotations;
  required_scope: ApiKeyScope | null;
  input_schema: TSchema;
  run: (
    db: Database,
    api_key: ApiKey,
    args: z.infer<TSchema>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}): BrainTool {
  return {
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    required_scope: tool.required_scope,
    json_schema: z.toJSONSchema(tool.input_schema, { io: 'input' }),
    run: (db, api_key, raw_arguments, signal) =>
      tool.run(db, api_key, parse_tool_arguments(tool.input_schema, raw_arguments), signal),
  };
}

function parse_tool_arguments<TSchema extends z.ZodType>(
  schema: TSchema,
  raw_arguments: unknown,
): z.infer<TSchema> {
  const parsed = schema.safeParse(raw_arguments ?? {});
  if (!parsed.success) {
    throw new ValidationError('Tool arguments failed validation', parsed.error.flatten());
  }
  return parsed.data;
}
