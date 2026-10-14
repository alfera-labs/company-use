// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Switch } from '@coworker/ui/components/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@coworker/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { AutomationTopBar } from '@/components/app/automations/automation_top_bar';
import {
  DeleteScheduledAutomation,
  use_scheduled_automation_actions,
} from '@/components/app/automations/scheduled_automation_actions';
import { ScheduledTaskEditDialog } from '@/components/app/scheduled_task_create_dialog';
import { ScheduledTaskDetails } from '@/components/app/scheduled_task_details';
import { ScheduledTaskHistory } from '@/components/app/scheduled_task_history';
import { list_triggers, relative_time, type Trigger } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function ScheduledAutomationPage({ triggerId }: { triggerId: string }) {
  const tasks_query = useQuery({ queryKey: query_keys.triggers(), queryFn: list_triggers });
  const task = (tasks_query.data ?? []).find((row) => row.trigger_id === triggerId);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-16">
      {task ? (
        <ScheduledAutomation task={task} />
      ) : (
        <>
          <AutomationTopBar name="Automation">{null}</AutomationTopBar>
          {tasks_query.isLoading ? (
            <Skeleton className="h-40 w-full rounded-3xl" />
          ) : tasks_query.isError ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>This automation could not be loaded.</span>
              <Button size="sm" variant="outline" onClick={() => void tasks_query.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This automation no longer exists.</p>
          )}
        </>
      )}
    </main>
  );
}

function ScheduledAutomation({ task }: { task: Trigger }) {
  const actions = use_scheduled_automation_actions(task);
  const live = task.trigger_status === 'enabled';
  const finished = task.trigger_status === 'completed';
  return (
    <>
      <AutomationTopBar name={task.trigger_name}>
        <ScheduledTaskEditDialog
          task={task}
          isSaving={actions.update.isPending}
          onSave={(input) => actions.update.mutateAsync(input)}
        />
        <Button
          disabled={!live || actions.run_now.isPending}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => actions.run_now.mutate()}
        >
          <Play aria-hidden="true" className="size-3" />
          Test
        </Button>
        <DeleteScheduledAutomation task={task} onDelete={() => actions.remove.mutate()} />
      </AutomationTopBar>
      <h1 className="font-semibold text-2xl">{task.trigger_name}</h1>
      <div className="mt-2.5 flex items-center gap-3 text-sm text-muted-foreground">
        <Switch
          aria-label={`Turn ${task.trigger_name} ${live ? 'off' : 'on'}`}
          checked={live}
          disabled={actions.set_live.isPending || finished}
          onCheckedChange={(checked) => actions.set_live.mutate(checked)}
        />
        <span>{finished ? 'Done' : live ? 'Active' : 'Paused'}</span>
        <span aria-hidden="true">|</span>
        <span>
          {task.last_run_time
            ? `Last ran ${relative_time(as_iso(task.last_run_time))}`
            : 'No runs yet'}
        </span>
      </div>
      <Tabs className="mt-5 gap-5" defaultValue="settings">
        <TabsList variant="line">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="history">Run history</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <ScheduledTaskDetails task={task} edit={null} />
        </TabsContent>
        <TabsContent value="history">
          <ScheduledTaskHistory triggerId={task.trigger_id} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function as_iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
