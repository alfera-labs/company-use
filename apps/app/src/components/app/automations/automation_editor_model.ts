import type {
  AutomationCreateBody,
  AutomationRule,
  AutomationTrigger,
  AutomationTriggerInput,
  AutomationUpdateBody,
  AutomationWithTriggers,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { with_account_named } from '@/components/app/automations/trigger_account_field';
import { setup_problems_of } from '@/components/app/automations/trigger_setup_answers';
import { trigger_row_to_input } from '@/components/app/automations/trigger_types_model';

export type EditorTrigger = {
  key: string;
  input: AutomationTriggerInput;
  row?: AutomationTrigger;
};

export type EditorValue = {
  name: string;
  instruction: string;
  triggers: EditorTrigger[];
  rules: AutomationRule[];
  judge_question: string;
  saved_judge: SavedJudge | null;
  budget: EditorBudget;
  run_policy: AutomationCreateBody['run_policy'];
};

type SavedJudge = NonNullable<AutomationCreateBody['judge']>;

export type EditorBudget = { max_fires_per_day: number; max_no_progress_runs: number };

export const default_budget: EditorBudget = { max_fires_per_day: 50, max_no_progress_runs: 3 };

export function empty_editor_value(): EditorValue {
  return {
    name: '',
    instruction: '',
    triggers: [],
    rules: [],
    judge_question: '',
    saved_judge: null,
    budget: default_budget,
    run_policy: undefined,
  };
}

export function editor_value_from(
  automation: AutomationWithTriggers['automation'],
  triggers: AutomationTrigger[],
): EditorValue {
  return {
    name: automation.automation_name,
    instruction: automation.instruction,
    triggers: triggers.map((row) => ({
      key: row.trigger_id,
      input: trigger_row_to_input(row),
      row,
    })),
    rules: [...automation.conditions],
    judge_question: automation.judge?.question ?? '',
    saved_judge: automation.judge ?? null,
    budget: {
      max_fires_per_day:
        automation.run_policy?.budget?.max_fires_per_day ?? default_budget.max_fires_per_day,
      max_no_progress_runs:
        automation.run_policy?.budget?.max_no_progress_runs ?? default_budget.max_no_progress_runs,
    },
    run_policy: automation.run_policy,
  };
}

export function with_saved_rows(value: EditorValue, rows: AutomationTrigger[]): EditorValue {
  const by_id = new Map(rows.map((row) => [row.trigger_id, row]));
  return {
    ...value,
    triggers: value.triggers.map((trigger) => {
      const row = trigger.row ? by_id.get(trigger.row.trigger_id) : undefined;
      return row ? { ...trigger, row } : trigger;
    }),
  };
}

export function editor_value_to_create_body(
  value: EditorValue,
  catalog: TriggerTypeCatalog | undefined,
): AutomationCreateBody {
  return {
    automation_name: value.name.trim(),
    instruction: value.instruction.trim(),
    triggers: value.triggers.map((trigger) => with_account_named(trigger.input, catalog)),
    conditions: value.rules,
    judge: read_judge(value),
    run_policy: { ...(value.run_policy ?? default_run_policy), budget: value.budget },
  };
}

const default_run_policy = {
  subject_from: null,
  when_a_run_is_already_going: 'wait_for_it_to_finish',
} as const;

export function editor_value_to_update_body(
  value: EditorValue,
  catalog: TriggerTypeCatalog | undefined,
): AutomationUpdateBody {
  return editor_value_to_create_body(value, catalog) as AutomationUpdateBody;
}

function read_judge(value: EditorValue) {
  const question = value.judge_question.trim();
  return question ? { ...value.saved_judge, question } : null;
}

export function editor_is_complete(
  value: EditorValue,
  catalog?: TriggerTypeCatalog | undefined,
): boolean {
  return (
    value.name.trim().length > 0 &&
    value.instruction.trim().length > 0 &&
    value.triggers.length > 0 &&
    value.triggers.every((trigger) => setup_problems_of(trigger.input, catalog).length === 0) &&
    value.rules.every((rule) => rule.field.trim().length > 0)
  );
}

export function is_dirty(before: EditorValue, after: EditorValue): boolean {
  return editor_fingerprint(before) !== editor_fingerprint(after);
}

function editor_fingerprint(value: EditorValue): string {
  return JSON.stringify([
    value.name.trim(),
    value.instruction.trim(),
    value.triggers.map((trigger) => trigger.input),
    value.rules,
    value.judge_question.trim(),
    value.budget,
    value.run_policy ?? null,
  ]);
}

export const rule_operations: ReadonlyArray<{
  operation: AutomationRule['operation'];
  label: string;
}> = [
  { operation: 'equals_any_of', label: 'is' },
  { operation: 'is_not_any_of', label: 'is not' },
  { operation: 'contains_any_of', label: 'contains' },
  { operation: 'does_not_contain_any_of', label: "doesn't contain" },
  { operation: 'is_present', label: 'is filled in' },
  { operation: 'is_absent', label: 'is empty' },
  { operation: 'address_is_any_of', label: 'email address is' },
  { operation: 'address_is_not_any_of', label: "email address isn't" },
  { operation: 'header_present', label: 'has email header' },
  { operation: 'header_missing', label: "doesn't have email header" },
];

const operations_without_values = new Set(['is_present', 'is_absent', 'header_missing']);

/** "is present" reads nothing; asking for a value next to it is a box nobody can fill in. */
export function rule_takes_values(operation: AutomationRule['operation']): boolean {
  return !operations_without_values.has(operation) && operation !== 'header_present';
}
