// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { public_brand_config } from '@coworker/config/public_env';
import { Input } from '@coworker/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  count_kinds,
  type KindFilter,
  KindFilters,
  kind_of_automation,
  kind_of_trigger_types,
  nothing_of_kind,
} from '@/components/app/automations/automation_kind';
import { use_automation_live_switch } from '@/components/app/automations/automation_live_switch';
import { AutomationRow } from '@/components/app/automations/automation_row';
import { list_automations, list_trigger_types } from '@/components/app/automations/automations_api';
import {
  AutomationsLayout,
  AutomationsLoadingRows,
} from '@/components/app/automations/automations_layout';
import { NewAutomationSheet } from '@/components/app/automations/new_automation_sheet';
import {
  ScheduledTaskRows,
  use_standalone_scheduled_tasks,
} from '@/components/app/automations/scheduled_task_rows';
import { query_keys } from '@/lib/api/query_keys';

const product_brand_name = public_brand_config.product_brand_name;

export function AutomationsPage() {
  const automations_query = useQuery({
    queryKey: query_keys.automations(),
    queryFn: list_automations,
  });
  const trigger_types_query = useQuery({
    queryKey: query_keys.automation_trigger_types(),
    queryFn: list_trigger_types,
  });
  const set_status = use_automation_live_switch();
  const [picked, set_picked] = useState<KindFilter>('all');
  const [search, set_search] = useState('');
  const all_automations = (automations_query.data ?? []).map((automation) => ({
    automation,
    kind: kind_of_automation(automation),
  }));
  const scheduled_tasks = use_standalone_scheduled_tasks();
  const counts = count_kinds([
    ...all_automations.map((row) => row.kind),
    ...scheduled_tasks.map((task) => kind_of_trigger_types([task.trigger_type])),
  ]);
  const showing = picked;
  const shown_tasks = scheduled_tasks.filter(
    (task) =>
      (showing === 'all' || kind_of_trigger_types([task.trigger_type]) === showing) &&
      name_matches(task.trigger_name, search),
  );
  const automations = all_automations.filter(
    (row) =>
      (showing === 'all' || row.kind === showing) &&
      name_matches(row.automation.automation_name, search),
  );
  const settled = !automations_query.isLoading && !automations_query.isError;
  const total_items = all_automations.length + scheduled_tasks.length;

  return (
    <AutomationsLayout current="automations">
      {automations_query.isLoading ? <AutomationsLoadingRows /> : null}
      {automations_query.isError ? (
        <p className="text-sm">Automations could not be loaded.</p>
      ) : null}
      {settled && all_automations.length === 0 && scheduled_tasks.length === 0 ? (
        <NothingRunsYet />
      ) : null}
      {total_items > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <KindFilters counts={counts} picked={showing} onPick={set_picked} />
          <SearchBox value={search} onChange={set_search} />
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {automations.map(({ automation, kind }) => (
          <AutomationRow
            key={automation.automation_id}
            automation={automation}
            kind={showing === 'all' ? kind : null}
            onPickKind={set_picked}
            isPending={
              set_status.isPending &&
              set_status.variables?.automation_id === automation.automation_id
            }
            catalog={trigger_types_query.data}
            onSetLive={(live) =>
              set_status.mutate({ automation_id: automation.automation_id, live })
            }
          />
        ))}
        <ScheduledTaskRows search={search} showing={showing} onPickKind={set_picked} />
      </ul>
      {settled && total_items > 0 && automations.length + shown_tasks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {search.trim() ? `Nothing matches "${search.trim()}".` : nothing_of_kind[showing]}
        </p>
      ) : null}
    </AutomationsLayout>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative ms-auto w-56">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label="Search automations"
        className="h-8 rounded-full ps-9"
        placeholder="Search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function name_matches(name: string, search: string) {
  return name.toLowerCase().includes(search.trim().toLowerCase());
}

function NothingRunsYet() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-lg font-medium">Nothing runs on its own yet.</p>
      <p className="max-w-sm text-sm text-muted-foreground text-pretty">
        Tell {product_brand_name} what should happen and when, in chat, and it appears here.
      </p>
      <div className="mt-2">
        <NewAutomationSheet />
      </div>
    </div>
  );
}
