import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Input } from '@coworker/ui/components/input';
import { MessageSquare, Plus, Webhook } from 'lucide-react';
import { useState } from 'react';
import { AppKeySetupItem, AppKeyStepsDialog } from '@/components/app/automations/app_key_steps';
import type {
  AutomationTriggerInput,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  AppSubmenu,
  ScheduledSubmenu,
  SearchItems,
} from '@/components/app/automations/trigger_menu_items';
import { local_timezone } from '@/components/app/automations/trigger_setup_form';
import {
  manual_picker_row,
  type PickerRow,
  picker_apps,
  webhook_picker_row,
} from '@/components/app/automations/trigger_types_model';
import { default_schedule_draft, draft_to_cron } from '@/lib/schedule_builder_model';

export function AddTriggerMenu({
  catalog,
  onAdd,
}: {
  catalog: TriggerTypeCatalog | undefined;
  onAdd: (input: AutomationTriggerInput) => void;
}) {
  const [open, set_open] = useState(false);
  const [query, set_query] = useState('');
  const [app_key_steps_open, set_app_key_steps_open] = useState(false);

  const choose = (row: PickerRow) => {
    onAdd(new_trigger_input(row));
    set_query('');
    set_open(false);
  };

  return (
    <>
      <AddTriggerDropdown
        catalog={catalog}
        open={open}
        query={query}
        onChoose={choose}
        onOpenAppKeySteps={() => set_app_key_steps_open(true)}
        onOpenChange={set_open}
        onQueryChange={set_query}
      />
      <AppKeyStepsDialog open={app_key_steps_open} onOpenChange={set_app_key_steps_open} />
    </>
  );
}

function AddTriggerDropdown({
  catalog,
  open,
  query,
  onChoose,
  onOpenAppKeySteps,
  onOpenChange,
  onQueryChange,
}: {
  catalog: TriggerTypeCatalog | undefined;
  open: boolean;
  query: string;
  onChoose: (row: PickerRow) => void;
  onOpenAppKeySteps: () => void;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        aria-label="Add trigger"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        Add trigger
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[26rem] w-72 overflow-y-auto">
        <SearchBox query={query} onChange={onQueryChange} />
        {query.trim() ? (
          <SearchItems catalog={catalog} query={query} onChoose={onChoose} />
        ) : (
          <BrowseItems
            catalog={catalog}
            onChoose={onChoose}
            onOpenAppKeySteps={onOpenAppKeySteps}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchBox({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return (
    <div className="p-1">
      <Input
        aria-label="Search all triggers"
        className="h-8 rounded-xl"
        placeholder="Search all triggers"
        value={query}
        // The menu's own typeahead would eat every letter typed here, so letters and deletes stay
        // in the box. Arrows, Enter and Escape still reach the menu, so ArrowDown walks into the
        // results.
        onKeyDown={(event) => {
          if (is_typing_key(event.key)) event.stopPropagation();
        }}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// A printable character is one code point ("a", " ", "é"); named keys are words ("ArrowDown").
function is_typing_key(key: string): boolean {
  return [...key].length === 1 || key === 'Backspace' || key === 'Delete';
}

function BrowseItems({
  catalog,
  onChoose,
  onOpenAppKeySteps,
}: {
  catalog: TriggerTypeCatalog | undefined;
  onChoose: (row: PickerRow) => void;
  onOpenAppKeySteps: () => void;
}) {
  return (
    <>
      <ScheduledSubmenu onChoose={onChoose} />
      {[manual_picker_row, webhook_picker_row].map((row) => (
        <DropdownMenuItem key={row.key} onClick={() => onChoose(row)}>
          <BuiltInIcon kind={row.kind} />
          <span className="min-w-0 flex-1 truncate">{row.display_name}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      {picker_apps(catalog).map((app) => (
        <AppSubmenu key={app.app_id} app={app} onChoose={onChoose} />
      ))}
      <AppKeySetupItem onOpen={onOpenAppKeySteps} />
      <DropdownMenuLabel>Every app you connect adds its triggers here.</DropdownMenuLabel>
    </>
  );
}

function BuiltInIcon({ kind }: { kind: PickerRow['kind'] }) {
  const Icon = kind === 'webhook' ? Webhook : MessageSquare;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

export function new_trigger_input(row: PickerRow): AutomationTriggerInput {
  if (row.kind === 'schedule') {
    return {
      kind: 'schedule',
      cron: row.cron ?? draft_to_cron(default_schedule_draft) ?? '0 9 * * *',
      timezone: local_timezone(),
    };
  }
  if (row.kind === 'manual' || row.kind === 'webhook') return { kind: row.kind };
  return { kind: 'app_event', node_key: row.key, subscription_config: {}, conditions: [] };
}
