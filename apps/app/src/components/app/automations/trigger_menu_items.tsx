import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { ChevronRight, Clock3 } from 'lucide-react';
import { AppMark } from '@/components/app/app_mark';
import type {
  TriggerTypeApp,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  catalog_picker_row,
  type PickerRow,
  schedule_preset_rows,
  search_trigger_types,
} from '@/components/app/automations/trigger_types_model';

export function ScheduledSubmenu({ onChoose }: { onChoose: (row: PickerRow) => void }) {
  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger className="flex items-center gap-2">
        <Clock3 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Scheduled</span>
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </DropdownMenuSubmenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="right">
        <RowItems rows={schedule_preset_rows} onChoose={onChoose} />
      </DropdownMenuContent>
    </DropdownMenuSubmenu>
  );
}

function RowItems({ rows, onChoose }: { rows: PickerRow[]; onChoose: (row: PickerRow) => void }) {
  return rows.map((row) => (
    <DropdownMenuItem key={row.key} onClick={() => onChoose(row)}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{row.display_name}</span>
        <span className="truncate text-xs text-muted-foreground">{row.description}</span>
      </span>
    </DropdownMenuItem>
  ));
}

export function AppSubmenu({
  app,
  onChoose,
}: {
  app: TriggerTypeApp;
  onChoose: (row: PickerRow) => void;
}) {
  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger className="flex items-center gap-2">
        <AppMark iconUrl={app.icon_url ?? undefined} name={app.app_display_name} />
        <span className="min-w-0 flex-1 truncate">{app.app_display_name}</span>
        {app.connected ? null : <span className="text-xs text-muted-foreground">Connect</span>}
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </DropdownMenuSubmenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[22rem] w-72 overflow-y-auto"
        side="right"
      >
        {app.trigger_types.map((row) => (
          <DropdownMenuItem
            key={row.node_key}
            onClick={() => onChoose(catalog_picker_row({ app, row }))}
          >
            <span className="truncate">{row.display_name_without_app}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenuSubmenu>
  );
}

export function SearchItems({
  catalog,
  query,
  onChoose,
}: {
  catalog: TriggerTypeCatalog | undefined;
  query: string;
  onChoose: (row: PickerRow) => void;
}) {
  const results = search_trigger_types(catalog, query);
  if (results.groups.length === 0) {
    return <DropdownMenuLabel>Nothing matches that.</DropdownMenuLabel>;
  }
  return (
    <>
      {results.groups.map(({ app, rows }) => (
        <div key={app.app_id}>
          <DropdownMenuLabel>{app.app_display_name}</DropdownMenuLabel>
          {rows.map((row) => (
            <DropdownMenuItem
              key={row.node_key}
              onClick={() => onChoose(catalog_picker_row({ app, row }))}
            >
              <span className="truncate">{row.display_name_without_app}</span>
            </DropdownMenuItem>
          ))}
        </div>
      ))}
    </>
  );
}
