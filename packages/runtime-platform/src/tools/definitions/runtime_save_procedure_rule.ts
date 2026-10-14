import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import {
  parse_procedure_rules,
  procedure_rules_path,
  render_procedure_rules,
  upsert_procedure_rule,
} from '@runtime-platform/skills/procedure_rules_file';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  procedure_slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  rule_key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+$/),
  rule_value: z.string().trim().min(1).max(300),
  customer_quote: z.string().trim().max(300).optional(),
});

export const runtime_save_procedure_rule_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-save_procedure_rule-1',
  node_name: 'save_procedure_rule',
  display_name: 'Save procedure rule',
  description:
    'Write one business rule into a procedure\'s rules file on the workspace volume, so every future run reads it as data instead of re-deriving it. Use the moment the user states or corrects a rule for a recurring job ("always exclude drafts", "only 15% for VIP customers"). Key is dot-scoped: `discount_percent` is the rule, `discount_percent.vip_customers` narrows it for one case. Saying a rule was saved without calling this is false.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      procedure_slug: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9-]*$',
        description:
          'The procedure folder under skills/ this rule belongs to, e.g. weekly-ordering.',
      },
      rule_key: {
        type: 'string',
        pattern: '^[A-Za-z0-9_.-]+$',
        description:
          'Stable snake_case key. A dotted suffix narrows a rule for one case: delivery_days.express_orders.',
      },
      rule_value: {
        type: 'string',
        minLength: 1,
        maxLength: 300,
        description: 'The value, plain: "500", "paid_and_overdue", "group_by_supplier".',
      },
      customer_quote: {
        type: 'string',
        maxLength: 300,
        description: "The user's own words stating the rule, kept beside it as provenance.",
      },
    },
    required: ['procedure_slug', 'rule_key', 'rule_value'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      outcome: { type: 'string', enum: ['added', 'replaced', 'unchanged'] },
      previous_value: { type: 'string' },
      rules_path: { type: 'string' },
      total_rules: { type: 'number' },
    },
    required: ['outcome', 'rules_path', 'total_rules'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.save_procedure_rule',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    const queue_key = `${context?.workspace_id ?? 'unknown'}:${input.procedure_slug}`;
    const previous = write_queues.get(queue_key) ?? Promise.resolve();
    const turn = previous.then(() => save_one_rule(input, context));
    write_queues.set(
      queue_key,
      turn.then(
        () => undefined,
        () => undefined,
      ),
    );
    return turn;
  },
};

const write_queues = new Map<string, Promise<unknown>>();

async function save_one_rule(
  input: z.infer<typeof input_schema>,
  context: Parameters<NonNullable<RuntimeToolDefinition['execute']>>[1],
) {
  const environment = context?.environment;
  if (!environment?.write_file || !environment.read_file) {
    return {
      success: false as const,
      error: {
        code: 'workspace_files_unavailable',
        message:
          'runtime-save_procedure_rule-1 needs the workspace file environment; without it the rule cannot be made durable, and claiming otherwise would be false.',
      },
    };
  }

  const rules_path = procedure_rules_path(input.procedure_slug);
  const existing_contents = await environment.read_file(rules_path).catch(() => undefined);
  const existing = parse_procedure_rules(existing_contents);

  const { rules, outcome } = upsert_procedure_rule(existing.rules, {
    rule_key: input.rule_key,
    rule_value: input.rule_value,
    ...(input.customer_quote ? { said_by_customer: input.customer_quote } : {}),
  });
  const previous_value = existing.rules.find(
    (rule) => rule.rule_key === input.rule_key,
  )?.rule_value;

  if (outcome !== 'unchanged') {
    await environment.write_file(
      rules_path,
      render_procedure_rules(input.procedure_slug, rules, existing.unparseable_lines),
    );
  }

  return {
    success: true as const,
    data: {
      outcome,
      ...(previous_value !== undefined && previous_value !== input.rule_value
        ? { previous_value }
        : {}),
      rules_path: generate_agent_visible_path(environment, rules_path),
      total_rules: rules.length,
    },
  };
}
