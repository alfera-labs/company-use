import { z } from 'zod';
import type { InternalToolDefinition, InternalToolView } from '@/components/app/internal_tool_view';

const tool_summary = z.object({
  node_key: z.string().optional(),
  app_name: z.string().optional(),
  node_name: z.string().optional(),
  description: z.string().nullable().optional(),
  connection_status: z.string().optional(),
});

const search_output = z.object({
  query: z.string(),
  result_count: z.number(),
  tools: z.array(tool_summary),
  fallback_tools: z.array(tool_summary),
  has_more: z.boolean(),
  next_offset: z.number().nullable(),
});

const schema_output = z.object({
  app_name: z.string(),
  node_name: z.string(),
  description: z.string().nullable().optional(),
  requires_connection: z.boolean(),
  input_schema: z.object({
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
});

const options_output = z.object({
  field_name: z.string(),
  options: z.array(z.unknown()),
  next_page_context: z.record(z.string(), z.unknown()).nullable(),
});

const skill_output = z.object({
  skill_slug: z.string(),
  skill_name: z.string(),
  content: z.string(),
  preloaded_tools: z.array(z.unknown()).optional(),
  resources: z.array(z.string()).optional(),
});

export const catalog_tool_definitions = {
  'runtime-search_tools': definition('catalog', 'Tool search', search_view),
  'runtime-get_tool_schema': definition('catalog', 'Tool details', schema_view),
  'runtime-list_tool_field_options': definition('catalog', 'Field options', options_view),
  'runtime-load_skill': definition('skills', 'Skill', skill_view),
} satisfies Record<string, InternalToolDefinition>;

function definition(
  family: 'catalog' | 'skills',
  title: string,
  read_view: (output: unknown) => InternalToolView | null,
): InternalToolDefinition {
  return { family, title, read_view: (_input, output) => read_view(output) };
}

function search_view(output: unknown): InternalToolView | null {
  const parsed = search_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  const tools = [...data.tools, ...data.fallback_tools];
  return {
    summary: `${data.result_count} ${plural(data.result_count, 'tool')} for “${data.query}”`,
    items: tools.map((tool) => ({
      title: readable_tool_name(tool),
      ...(tool.description ? { detail: tool.description } : {}),
    })),
    ...(tools.length === 0 ? { empty_message: 'No matching tools were found.' } : {}),
  };
}

function schema_view(output: unknown): InternalToolView | null {
  const parsed = schema_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  const required = new Set(data.input_schema.required ?? []);
  return {
    summary:
      data.description || `${readable_name(data.node_name)} in ${readable_name(data.app_name)}`,
    items: Object.entries(data.input_schema.properties ?? {}).map(([name, schema]) => ({
      title: readable_name(name),
      detail: `${schema_type(schema)} · ${required.has(name) ? 'Required' : 'Optional'}`,
    })),
    fields: [
      { label: 'Connection', value: data.requires_connection ? 'Required' : 'Not required' },
    ],
    ...(Object.keys(data.input_schema.properties ?? {}).length === 0
      ? { empty_message: 'This tool has no input fields.' }
      : {}),
  };
}

function options_view(output: unknown): InternalToolView | null {
  const parsed = options_output.safeParse(output);
  if (!parsed.success) return null;
  const options = parsed.data.options.flatMap(read_option);
  return {
    summary: `Options for ${readable_name(parsed.data.field_name)}`,
    items: options,
    fields: parsed.data.next_page_context ? [{ label: 'More options', value: 'Available' }] : [],
    ...(options.length === 0 ? { empty_message: 'No field options were found.' } : {}),
  };
}

function skill_view(output: unknown): InternalToolView | null {
  const parsed = skill_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: data.skill_name,
    text: data.content,
    items: (data.resources ?? []).map((resource) => ({ title: resource })),
    fields: [{ label: 'Ready tools', value: String(data.preloaded_tools?.length ?? 0) }],
  };
}

function read_option(value: unknown) {
  const parsed = z.object({ label: z.string(), value: z.unknown().optional() }).safeParse(value);
  if (!parsed.success) return [];
  const detail = primitive_text(parsed.data.value);
  return [{ title: parsed.data.label, ...(detail ? { detail } : {}) }];
}

function schema_type(value: unknown) {
  const parsed = z
    .object({ type: z.union([z.string(), z.array(z.string())]).optional() })
    .safeParse(value);
  if (!parsed.success || !parsed.data.type) return 'Value';
  return Array.isArray(parsed.data.type) ? parsed.data.type.join(' or ') : parsed.data.type;
}

function primitive_text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function readable_tool_name(tool: z.infer<typeof tool_summary>) {
  const node_name = tool.node_name || (tool.node_key && node_name_from_key(tool.node_key));
  if (node_name) return readable_name(node_name);
  if (tool.app_name) return `${readable_name(tool.app_name)} tool`;
  return 'Tool';
}

function node_name_from_key(node_key: string) {
  const [, ...name] = node_key.replace(/-\d+$/u, '').split('-');
  return name.join('-');
}

function readable_name(value: string) {
  return value.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}
