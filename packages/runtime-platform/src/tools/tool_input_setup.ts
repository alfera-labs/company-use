import type { JsonSchema } from '@coworker/shared';

export type ToolInputSetupStep = 'get_schema' | 'list_options';

const tool_input_setup_rules: Array<{
  field_flag: string;
  step: ToolInputSetupStep;
  flag_is_enabled: (value: unknown) => boolean;
}> = [
  {
    field_flag: 'reload_props',
    step: 'get_schema',
    flag_is_enabled: (value) => value === true,
  },
  {
    field_flag: 'dynamic_options',
    step: 'list_options',
    flag_is_enabled: (value) => value !== undefined && value !== null && value !== false,
  },
];

export function list_tool_input_setup_steps(schema: unknown): ToolInputSetupStep[] {
  const fields = list_tool_input_fields(schema);
  return tool_input_setup_rules
    .filter((rule) => fields.some((field) => field_uses_setup_rule(field, rule)))
    .map((rule) => rule.step);
}

export function tool_input_needs_schema_id(schema: unknown) {
  return list_tool_input_setup_steps(schema).includes('get_schema');
}

function list_tool_input_fields(schema: unknown) {
  return Object.values(
    ((schema as JsonSchema | null)?.properties ?? {}) as Record<string, JsonSchema>,
  );
}

function field_uses_setup_rule(field: JsonSchema, rule: (typeof tool_input_setup_rules)[number]) {
  const metadata = (field as JsonSchema & { field?: unknown }).field;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return rule.flag_is_enabled((metadata as Record<string, unknown>)[rule.field_flag]);
}
