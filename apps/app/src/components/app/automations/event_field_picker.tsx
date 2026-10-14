import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
} from '@coworker/ui/components/combobox';
import { ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';
import type { EventFieldGroup } from '@/components/app/automations/event_field_options';

export function EventFieldPicker({
  groups,
  value,
  invalid,
  onChange,
}: {
  groups: EventFieldGroup[];
  value: string;
  invalid: boolean;
  onChange: (key: string) => void;
}) {
  const [query, set_query] = useState('');
  const shown = filter_groups(groups, query);
  const typed = query.trim();
  const offer_typed = typed.length > 0 && !groups.some((group) => has_key(group, typed));
  const keys = [...shown.flatMap((group) => group.options.map((option) => option.key))];
  if (offer_typed) keys.push(typed);

  return (
    <Combobox
      filter={null}
      inputValue={query}
      items={keys}
      value={value || null}
      onInputValueChange={(next: string) => set_query(next)}
      onOpenChange={(open: boolean) => {
        if (!open) set_query('');
      }}
      onValueChange={(key: string | null) => {
        if (key) onChange(key);
      }}
    >
      <ComboboxTrigger
        aria-invalid={invalid || undefined}
        aria-label="Field"
        className="field flex h-8 flex-1 items-center justify-between gap-1.5 px-3 text-sm"
      >
        <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>
          {value ? label_for(groups, value) : 'Choose what to check'}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <FieldPickerPopup
        shown={shown}
        typed={offer_typed ? typed : null}
        empty={keys.length === 0}
      />
    </Combobox>
  );
}

function FieldPickerPopup({
  shown,
  typed,
  empty,
}: {
  shown: EventFieldGroup[];
  typed: string | null;
  empty: boolean;
}) {
  return (
    <ComboboxPortal>
      <ComboboxPositioner align="start" sideOffset={4}>
        <ComboboxPopup className="flex max-h-80 w-72 flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <ComboboxInput aria-label="Search" placeholder="Search" />
          </div>
          <ComboboxEmpty>
            {empty ? 'Add a trigger first. Its details show up here.' : undefined}
          </ComboboxEmpty>
          <ComboboxList>
            {shown.map((group) => (
              <ComboboxGroup key={group.group_label}>
                <ComboboxGroupLabel className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
                  {group.group_label}
                </ComboboxGroupLabel>
                {group.options.map((option) => (
                  <FieldItem key={option.key} field_key={option.key} label={option.label} />
                ))}
              </ComboboxGroup>
            ))}
            {typed ? <FieldItem field_key={typed} label={`Use "${typed}"`} /> : null}
          </ComboboxList>
        </ComboboxPopup>
      </ComboboxPositioner>
    </ComboboxPortal>
  );
}

function FieldItem({ field_key, label }: { field_key: string; label: string }) {
  return (
    <ComboboxItem value={field_key}>
      <span className="truncate">{label}</span>
    </ComboboxItem>
  );
}

function filter_groups(groups: EventFieldGroup[], query: string): EventFieldGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) =>
        `${option.label} ${option.key}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.options.length > 0);
}

function has_key(group: EventFieldGroup, key: string): boolean {
  return group.options.some((option) => option.key === key);
}

function label_for(groups: EventFieldGroup[], key: string): string {
  for (const group of groups) {
    const found = group.options.find((option) => option.key === key);
    if (found) return found.label;
  }
  return key;
}
