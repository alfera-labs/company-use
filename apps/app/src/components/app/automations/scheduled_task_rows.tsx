// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { Switch } from '@coworker/ui/components/switch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  type AutomationKind,
  KindChip,
  type KindFilter,
  kind_of_trigger_types,
} from '@/components/app/automations/automation_kind';
import {
  CardBody,
  LeadTile,
  ListCard,
  WhatItDoes,
} from '@/components/app/automations/automation_list_card';
import { StartChip } from '@/components/app/automations/automation_start_line';
import { list_triggers, relative_time, set_trigger_status, type Trigger } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { describe_schedule, read_instruction } from '@/lib/scheduled_task_schedule';

export function use_standalone_scheduled_tasks() {
  const tasks_query = useQuery({ queryKey: query_keys.triggers(), queryFn: list_triggers });
  return (tasks_query.data ?? []).filter(is_standalone_scheduled_task);
}

export function ScheduledTaskRows({
  search,
  showing,
  onPickKind,
}: {
  search: string;
  showing: KindFilter;
  onPickKind: (kind: AutomationKind) => void;
}) {
  const live_switch = use_schedule_live_switch();
  const scheduled_tasks = use_standalone_scheduled_tasks().filter(
    (task) =>
      (showing === 'all' || kind_of_trigger_types([task.trigger_type]) === showing) &&
      task.trigger_name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return scheduled_tasks.map((task) => (
    <ScheduledTaskRow
      key={task.trigger_id}
      task={task}
      showKind={showing === 'all'}
      isPending={live_switch.isPending && live_switch.variables?.trigger_id === task.trigger_id}
      onPickKind={onPickKind}
      onSetLive={(live) => live_switch.mutate({ trigger_id: task.trigger_id, live })}
    />
  ));
}

function ScheduledTaskRow({
  task,
  showKind,
  isPending,
  onPickKind,
  onSetLive,
}: {
  task: Trigger;
  showKind: boolean;
  isPending: boolean;
  onPickKind: (kind: AutomationKind) => void;
  onSetLive: (live: boolean) => void;
}) {
  const live = task.trigger_status === 'enabled';
  return (
    <ListCard off={!live}>
      <LeadTile>
        <Clock3 />
      </LeadTile>
      <CardBody off={!live}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            className="truncate text-sm font-medium after:absolute after:inset-0"
            to="/automations/$automation_id"
            params={{ automation_id: task.trigger_id }}
          >
            {task.trigger_name}
          </Link>
          {showKind ? (
            <KindChip kind={kind_of_trigger_types([task.trigger_type])} onPick={onPickKind} />
          ) : null}
        </div>
        <WhatItDoes instruction={read_instruction(task)} />
        <div className="mt-1.5 flex">
          <StartChip icon={<Clock3 aria-hidden="true" className="size-3.5 shrink-0" />}>
            {task.trigger_type === 'manual'
              ? 'When you ask'
              : describe_schedule(task.schedule_expression)}
          </StartChip>
        </div>
      </CardBody>
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {task.last_run_time ? `ran ${relative_time(as_iso(task.last_run_time))}` : 'never ran'}
      </span>
      <Switch
        className="relative z-10"
        aria-label={`Turn ${task.trigger_name} ${live ? 'off' : 'on'}`}
        checked={live}
        disabled={isPending}
        onCheckedChange={onSetLive}
      />
    </ListCard>
  );
}

export function use_schedule_live_switch() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: ({ trigger_id, live }: { trigger_id: string; live: boolean }) =>
      set_trigger_status(trigger_id, live ? 'enabled' : 'disabled'),
    onMutate: async ({ trigger_id, live }) => {
      await query_client.cancelQueries({ queryKey: query_keys.triggers() });
      const before = query_client.getQueryData<Trigger[]>(query_keys.triggers());
      query_client.setQueryData<Trigger[]>(query_keys.triggers(), (rows) =>
        rows?.map((row) =>
          row.trigger_id === trigger_id
            ? { ...row, trigger_status: live ? 'enabled' : 'disabled' }
            : row,
        ),
      );
      return { before };
    },
    onError: (error, _input, context) => {
      if (context?.before) query_client.setQueryData(query_keys.triggers(), context.before);
      toast.error(format_error_message(error, 'Could not change the automation'));
    },
    onSettled: () => void query_client.invalidateQueries({ queryKey: query_keys.triggers() }),
  });
}

export function is_standalone_scheduled_task(task: Trigger) {
  if (task.automation_id) return false;
  const source = system_marks.safeParse(task.trigger_source);
  if (source.success && (source.data.origin === 'system' || source.data.kind === 'system')) {
    return false;
  }
  if (task.created_by?.startsWith('system:')) return false;
  return task.trigger_type === 'schedule' || task.trigger_type === 'manual';
}

const system_marks = z.object({ origin: z.string().optional(), kind: z.string().optional() });

function as_iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
