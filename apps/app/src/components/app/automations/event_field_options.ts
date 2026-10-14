import type { EditorValue } from '@/components/app/automations/automation_editor_model';
import type { TriggerTypeCatalog } from '@/components/app/automations/automations_api';
import { find_trigger_type } from '@/components/app/automations/trigger_types_model';

type EventFieldOption = { key: string; label: string };
export type EventFieldGroup = { group_label: string; options: EventFieldOption[] };

const any_trigger_label = 'Every trigger';

export function build_event_field_groups(
  value: EditorValue,
  catalog: TriggerTypeCatalog | undefined,
): EventFieldGroup[] {
  const per_trigger = read_trigger_fields(value, catalog);
  const counts = new Map<string, number>();
  for (const { options } of per_trigger)
    for (const { key } of options) counts.set(key, (counts.get(key) ?? 0) + 1);
  const is_shared = (option: EventFieldOption) => (counts.get(option.key) ?? 0) > 1;
  const shared = new Map(
    per_trigger.flatMap(({ options }) => options.filter(is_shared)).map((o) => [o.key, o]),
  );
  const groups = per_trigger.map(({ group_label, options }) => ({
    group_label,
    options: sort_options(options.filter((option) => !is_shared(option))),
  }));
  return [
    { group_label: any_trigger_label, options: sort_options([...shared.values()]) },
    ...groups,
  ].filter((group) => group.options.length > 0);
}

function read_trigger_fields(value: EditorValue, catalog: TriggerTypeCatalog | undefined) {
  const seen = new Set<string>();
  const found: EventFieldGroup[] = [];
  for (const trigger of value.triggers) {
    if (trigger.input.kind !== 'app_event' || seen.has(trigger.input.node_key)) continue;
    seen.add(trigger.input.node_key);
    const entry = find_trigger_type(catalog, trigger.input.node_key);
    if (!entry) continue;
    found.push({
      group_label: `${entry.app.app_display_name} · ${entry.row.display_name_without_app}`,
      options: [...new Map(entry.row.event_fields.map((field) => [field.name, field.label]))].map(
        ([key, label]) => ({ key, label }),
      ),
    });
  }
  return found;
}

function sort_options(options: EventFieldOption[]): EventFieldOption[] {
  return [...options].sort((left, right) => (left.key < right.key ? -1 : 1));
}
