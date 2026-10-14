import { z } from 'zod';
import type { InternalToolDefinition, InternalToolView } from '@/components/app/internal_tool_view';

const attachment_output = z.object({
  path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  byte_size: z.number(),
});

const rule_input = z.object({
  procedure_slug: z.string(),
  rule_key: z.string(),
  rule_value: z.string(),
});
const rule_output = z.object({
  outcome: z.enum(['added', 'replaced', 'unchanged']),
  previous_value: z.string().optional(),
  rules_path: z.string(),
  total_rules: z.number(),
});

const name_output = z.object({ agent_name: z.string(), summary: z.string() });
const calculation_output = z.object({
  expression: z.string(),
  result: z.string(),
  fraction: z.string(),
  exact: z.boolean(),
  rounded: z.boolean(),
  decimal_places: z.number(),
});

export const runtime_tool_definitions = {
  'runtime-read_attachment': runtime_definition('files', 'Attachment', attachment_view),
  'runtime-save_procedure_rule': {
    family: 'skills',
    title: 'Procedure rule',
    read_view: rule_view,
  },
  'runtime-set_agent_name': runtime_definition('assistant', 'Assistant name', name_view),
  'math-calculate': runtime_definition('calculation', 'Calculation', calculation_view),
} satisfies Record<string, InternalToolDefinition>;

function runtime_definition(
  family: 'assistant' | 'calculation' | 'files',
  title: string,
  read_view: (output: unknown) => InternalToolView | null,
): InternalToolDefinition {
  return { family, title, read_view: (_input, output) => read_view(output) };
}

function attachment_view(output: unknown): InternalToolView | null {
  const parsed = attachment_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: data.file_name,
    items: [
      { title: data.file_name, detail: `${data.mime_type} · ${format_bytes(data.byte_size)}` },
    ],
    fields: [{ label: 'Workspace path', value: data.path }],
  };
}

function rule_view(input: unknown, output: unknown): InternalToolView | null {
  const parsed_input = rule_input.safeParse(input);
  const parsed_output = rule_output.safeParse(output);
  if (!parsed_input.success || !parsed_output.success) return null;
  const rule = parsed_input.data;
  const result = parsed_output.data;
  return {
    summary: `${readable_outcome(result.outcome)} ${rule.rule_key}`,
    text: rule.rule_value,
    fields: [
      { label: 'Procedure', value: rule.procedure_slug },
      { label: 'Rules file', value: result.rules_path },
      { label: 'Total rules', value: String(result.total_rules) },
      ...(result.previous_value ? [{ label: 'Previous value', value: result.previous_value }] : []),
    ],
  };
}

function name_view(output: unknown): InternalToolView | null {
  const parsed = name_output.safeParse(output);
  if (!parsed.success) return null;
  return {
    summary: parsed.data.summary,
    fields: [{ label: 'Name', value: parsed.data.agent_name }],
  };
}

function calculation_view(output: unknown): InternalToolView | null {
  const parsed = calculation_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: data.rounded ? `Rounded to ${data.decimal_places} decimal places` : 'Exact result',
    calculation: {
      expression: data.expression,
      result: data.result,
      exact: data.exact,
      fraction: data.fraction,
    },
  };
}

function readable_outcome(outcome: z.infer<typeof rule_output>['outcome']) {
  if (outcome === 'replaced') return 'Updated';
  if (outcome === 'unchanged') return 'Kept';
  return 'Added';
}

function format_bytes(byte_size: number) {
  if (byte_size < 1_000) return `${byte_size} B`;
  if (byte_size < 1_000_000) return `${(byte_size / 1_000).toFixed(1)} KB`;
  return `${(byte_size / 1_000_000).toFixed(1)} MB`;
}
