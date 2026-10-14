import { Input } from '@coworker/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Textarea } from '@coworker/ui/components/textarea';
import { useState } from 'react';
import {
  type EditorValue,
  rule_operations,
  rule_takes_values,
} from '@/components/app/automations/automation_editor_model';
import {
  EditorSection,
  SectionAction,
} from '@/components/app/automations/automation_editor_panels';
import type {
  AutomationRule,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  build_event_field_groups,
  type EventFieldGroup,
} from '@/components/app/automations/event_field_options';
import { EventFieldPicker } from '@/components/app/automations/event_field_picker';
import { RemoveButton } from '@/components/app/automations/remove_button';

type PanelProps = {
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  catalog: TriggerTypeCatalog | undefined;
};

export function ConditionsPanel({ value, onChange, catalog }: PanelProps) {
  return (
    <>
      <OnlyIfSection value={value} onChange={onChange} catalog={catalog} />
      <EditorSection title="Only run if">
        <Textarea
          aria-label="Only run if"
          className="min-h-20 resize-y rounded-3xl border-0 bg-transparent px-4 py-3.5 shadow-none focus-visible:ring-0"
          placeholder="it's a new customer asking for a price or a meeting"
          value={value.judge_question}
          onChange={(event) => onChange({ ...value, judge_question: event.target.value })}
        />
      </EditorSection>
    </>
  );
}

function OnlyIfSection({ value, onChange, catalog }: PanelProps) {
  const field_groups = build_event_field_groups(value, catalog);
  const set_rules = (rules: AutomationRule[]) => onChange({ ...value, rules });
  const blank_rule: AutomationRule = { field: '', operation: 'equals_any_of', values: [] };
  return (
    <EditorSection
      title="Filters"
      action={
        <SectionAction label="Add filter" onClick={() => set_rules([...value.rules, blank_rule])} />
      }
    >
      {value.rules.map((rule, index) => (
        <RuleRow
          // biome-ignore lint/suspicious/noArrayIndexKey: a rule has no id of its own and this list never reorders, so its position is its identity
          key={index}
          rule={rule}
          fieldGroups={field_groups}
          onChange={(next) => set_rules(value.rules.map((old, at) => (at === index ? next : old)))}
          onRemove={() => set_rules(value.rules.filter((_, at) => at !== index))}
        />
      ))}
      {value.rules.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No filters.</p>
      ) : null}
    </EditorSection>
  );
}

function RuleRow({
  rule,
  fieldGroups,
  onChange,
  onRemove,
}: {
  rule: AutomationRule;
  fieldGroups: EventFieldGroup[];
  onChange: (rule: AutomationRule) => void;
  onRemove: () => void;
}) {
  const takes_values = rule_takes_values(rule.operation);
  const no_field = !rule.field.trim();
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <EventFieldPicker
          groups={fieldGroups}
          invalid={no_field}
          value={rule.field}
          onChange={(field) => onChange({ ...rule, field })}
        />
        <RuleOperationSelect rule={rule} onChange={onChange} />
        {takes_values ? (
          <RuleValuesInput
            values={rule.values ?? []}
            onCommit={(values) => onChange({ ...rule, values })}
          />
        ) : (
          <span className="flex-1" />
        )}
        <RemoveButton label="Remove this filter" onClick={onRemove} />
      </div>
      {no_field ? (
        <span className="mt-1 block text-sm text-caution-ink">
          Choose what to check, or remove this filter.
        </span>
      ) : null}
    </div>
  );
}

function RuleOperationSelect({
  rule,
  onChange,
}: {
  rule: AutomationRule;
  onChange: (rule: AutomationRule) => void;
}) {
  return (
    <Select
      value={rule.operation}
      onValueChange={(operation) =>
        onChange({ ...rule, operation: operation as AutomationRule['operation'] })
      }
    >
      <SelectTrigger aria-label="Check" className="h-8 flex-1 rounded-xl" size="sm">
        <SelectValue>
          {rule_operations.find((item) => item.operation === rule.operation)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {rule_operations.map((item) => (
          <SelectItem key={item.operation} value={item.operation}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RuleValuesInput({
  values,
  onCommit,
}: {
  values: string[];
  onCommit: (values: string[]) => void;
}) {
  const [typed, set_typed] = useState<string | null>(null);
  return (
    <Input
      aria-label="Values, separated by commas"
      className="h-8 flex-1 rounded-xl"
      placeholder="Separate several with commas"
      value={typed ?? values.join(', ')}
      onChange={(event) => set_typed(event.target.value)}
      onBlur={() => {
        if (typed !== null) onCommit(read_values(typed));
        set_typed(null);
      }}
    />
  );
}

function read_values(text: string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
