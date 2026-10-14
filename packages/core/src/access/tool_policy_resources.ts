import type { PolicyResourceCandidate, PolicyRule } from '@coworker/core/access/policy_modes';
import type {
  ApprovalPolicyData,
  NodeMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { find_tool_call_subjects, tool_call_subject_policy_id } from '@coworker/shared';

type ToolPolicyInput = {
  node_key: string;
  approval_policy: ApprovalPolicyData | null | undefined;
  metadata: NodeMetadataData | null | undefined;
  tool_input?: unknown;
};

type ToolLabelDefinition = {
  breadth: number;
  matches: (tool: ToolPolicyInput) => boolean;
};

const email_app_terms = ['email', 'gmail', 'mailgun', 'outlook', 'sendgrid', 'smtp'] as const;
const email_delivery_terms = ['forward', 'reply', 'send'] as const;

const tool_label_definitions: Record<string, ToolLabelDefinition> = {
  every_tool: { breadth: 10, matches: () => true },
  only_reads: { breadth: 20, matches: (tool) => !tool_changes_things(tool) },
  changes_things: { breadth: 20, matches: tool_changes_things },
  emails_outsiders: { breadth: 30, matches: emails_outsiders },
};

const subject_specificity = { this_action: 300, any_action: 200 } as const;

const asks_before_any_rule_exists = ['emails_outsiders'] as const;
const built_in_specificity = 5;

export const node_rule_specificity = 100;

export function built_in_policy_rules(workspace_id: string): PolicyRule[] {
  return asks_before_any_rule_exists.map((label) => ({
    resource_type: 'built_in_default',
    resource_id: label,
    scope_type: 'workspace',
    scope_id: workspace_id,
    policy_mode: 'ask',
  }));
}

export function build_tool_policy_resources(tool: ToolPolicyInput): PolicyResourceCandidate[] {
  if (tool.metadata?.policy_exempt === true) return [];
  return [
    ...asks_before_any_rule_exists.flatMap((label) =>
      tool_label_definitions[label]?.matches(tool)
        ? [
            {
              resource_type: 'built_in_default',
              resource_id: label,
              specificity: built_in_specificity,
            },
          ]
        : [],
    ),
    ...find_tool_call_subjects(tool.tool_input).map((subject) => ({
      resource_type: 'tool_subject',
      resource_id: tool_call_subject_policy_id(subject, tool.node_key),
      specificity: subject_specificity[subject.grain],
    })),
    { resource_type: 'node', resource_id: tool.node_key, specificity: node_rule_specificity },
    ...Object.entries(tool_label_definitions).flatMap(([resource_id, definition]) =>
      definition.matches(tool)
        ? [
            {
              resource_type: 'node_label',
              resource_id,
              specificity: 50 + definition.breadth,
            },
          ]
        : [],
    ),
  ];
}

export function get_tool_policy_group(tool: ToolPolicyInput): 'only_reads' | 'changes_things' {
  return tool_changes_things(tool) ? 'changes_things' : 'only_reads';
}

function tool_changes_things(tool: ToolPolicyInput) {
  return explicit_label('changes_things')(tool) || tool.approval_policy?.mode === 'manual_review';
}

function explicit_label(label: string) {
  return (tool: ToolPolicyInput) => tool.metadata?.policy_labels?.includes(label) === true;
}

function emails_outsiders(tool: ToolPolicyInput) {
  if (explicit_label('emails_outsiders')(tool)) return true;
  const { app_name, action_name } = node_parts(tool.node_key);
  return (
    includes_term(app_name, email_app_terms) && includes_term(action_name, email_delivery_terms)
  );
}

function node_parts(node_key: string) {
  const [app_name = '', action_name = ''] = node_key.toLowerCase().split('-');
  return { app_name, action_name };
}

function includes_term(value: string, terms: readonly string[]) {
  const tokens = new Set(value.split('_'));
  return terms.some((term) => tokens.has(term));
}
