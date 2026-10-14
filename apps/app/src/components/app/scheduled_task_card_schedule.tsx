// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { is_workspace_administrator_role } from '@coworker/shared';
import { useQuery } from '@tanstack/react-query';
import { team_member_name } from '@/components/app/team_mode_words';
import { use_team_viewer_role } from '@/components/app/use_team_mode';
import type { Trigger } from '@/lib/api';
import { read_team, team_query_key } from '@/lib/api/team_mode';
import { describe_schedule } from '@/lib/scheduled_task_schedule';

/**
 * When a task runs, on a card: the time with its time zone. An owner or an admin of a team
 * install sees the tasks of several people, so their card also says who made the task.
 */
export function ScheduledTaskCardSchedule({ task }: { task: Trigger }) {
  const run_once_at = read_run_once_at(task);
  const time_zone = run_once_at ? null : read_time_zone(task);
  const maker_name = use_task_maker_name(task.created_by);
  return (
    <>
      <div className="mt-1.5 truncate text-muted-foreground text-sm">
        {describe_task_schedule(task, run_once_at)}
        {time_zone ? <span> · {time_zone}</span> : null}
      </div>
      {maker_name ? (
        <div className="mt-1 truncate text-xs text-muted-foreground">Made by {maker_name}</div>
      ) : null}
    </>
  );
}

function use_task_maker_name(user_id: string): string | null {
  const sees_tasks_of_other_people = is_workspace_administrator_role(use_team_viewer_role());
  const team = useQuery({
    queryKey: team_query_key,
    queryFn: read_team,
    enabled: sees_tasks_of_other_people,
  }).data;
  const maker = team?.members.find((member) => member.user_id === user_id);
  return maker ? team_member_name(maker) : null;
}

function describe_task_schedule(task: Trigger, run_once_at: string | null) {
  if (task.trigger_type === 'manual') return 'Run manually';
  const instant = new Date(run_once_at ?? Number.NaN);
  if (Number.isNaN(instant.getTime())) return describe_schedule(task.schedule_expression);
  return `Run once ${instant.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  })}`;
}

function read_task_setting(task: Trigger, name: 'run_once_at' | 'timezone'): string | null {
  const config = task.trigger_config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

export function read_run_once_at(task: Trigger): string | null {
  return read_task_setting(task, 'run_once_at');
}

function read_time_zone(task: Trigger): string | null {
  return task.trigger_type === 'manual' ? null : read_task_setting(task, 'timezone');
}
