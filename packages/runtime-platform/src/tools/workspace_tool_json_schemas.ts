import type { RuntimeJsonSchema } from '@agent-core/tools/runtime_tool';

export function object_schema(
  properties: Record<string, RuntimeJsonSchema>,
  required: string[] = [],
): RuntimeJsonSchema {
  return { type: 'object', properties, required };
}

export function string_schema(description: string): RuntimeJsonSchema {
  return { type: 'string', description };
}

export function boolean_schema(description: string): RuntimeJsonSchema {
  return { type: 'boolean', description };
}

export function number_schema(description: string): RuntimeJsonSchema {
  return { type: 'number', description };
}
