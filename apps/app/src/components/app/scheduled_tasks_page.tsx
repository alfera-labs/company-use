import { public_brand_config } from '@coworker/config/public_env';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import { Link } from '@tanstack/react-router';
import { Clock3, Loader2, Pause, Play, Search, Trash2 } from 'lucide-react';
import type * as React from 'react';
import {
  read_run_once_at,
  ScheduledTaskCardSchedule,
} from '@/components/app/scheduled_task_card_schedule';
import {
  type CreateScheduledTaskInput,
  ScheduledTaskCreateDialog,
} from '@/components/app/scheduled_task_create_dialog';
import { relative_time, type Trigger } from '@/lib/api';
import { read_instruction } from '@/lib/scheduled_task_schedule';

const product_brand_name = public_brand_config.product_brand_name;
const loading_row_keys = ['one', 'two', 'three', 'four', 'five', 'six'];

export function ScheduledTasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col pb-10">
      <h1 className="mt-1 text-xl font-semibold text-balance">Scheduled tasks</h1>
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        Let {product_brand_name} run on a schedule, automatically.
      </p>
      <div className="mt-7 flex flex-col gap-5">{children}</div>
    </main>
  );
}

export function ScheduledTasksControls({
  taskCount,
  searchQuery,
  onSearchChange,
  onCreate,
  isCreating,
  create_control,
}: {
  taskCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCreate: (input: CreateScheduledTaskInput) => Promise<void>;
  isCreating: boolean;
  create_control?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-base font-medium tabular-nums">
        {taskCount === 1 ? '1 scheduled task' : `${taskCount.toLocaleString()} scheduled tasks`}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-full sm:w-64">
          <label className="sr-only" htmlFor="tasks-search">
            Search scheduled tasks
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="tasks-search"
            className="h-9 rounded-2xl pl-9"
            placeholder="Search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {create_control ?? (
          <ScheduledTaskCreateDialog onCreate={onCreate} isCreating={isCreating} />
        )}
      </div>
    </div>
  );
}

export function ScheduledTasksGrid({
  tasks,
  isError,
  isLoading,
  pendingStatusId,
  deletingId,
  runningId,
  searchQuery,
  onClearSearch,
  onToggleStatus,
  onDelete,
  onRun,
  onRetry,
}: {
  tasks: Trigger[];
  isError: boolean;
  isLoading: boolean;
  pendingStatusId: string | null;
  deletingId: string | null;
  runningId: string | null;
  searchQuery: string;
  onClearSearch: () => void;
  onToggleStatus: (task: Trigger) => void;
  onDelete: (trigger_id: string) => void;
  onRun: (trigger_id: string) => void;
  onRetry: () => void;
}) {
  if (isLoading) return <LoadingGrid />;
  if (isError) return <QueryError label="Scheduled tasks" onRetry={onRetry} />;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title={searchQuery ? 'No scheduled tasks found' : 'No scheduled tasks yet'}
        actionLabel={searchQuery ? 'Clear search' : undefined}
        onAction={searchQuery ? onClearSearch : undefined}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => (
        <TaskRow
          task={task}
          isStatusPending={pendingStatusId === task.trigger_id}
          isDeletePending={deletingId === task.trigger_id}
          isRunPending={runningId === task.trigger_id}
          key={task.trigger_id}
          onToggleStatus={() => onToggleStatus(task)}
          onDelete={() => onDelete(task.trigger_id)}
          onRun={() => onRun(task.trigger_id)}
        />
      ))}
    </div>
  );
}

function TaskRow({
  task,
  isStatusPending,
  isDeletePending,
  isRunPending,
  onToggleStatus,
  onDelete,
  onRun,
}: {
  task: Trigger;
  isStatusPending: boolean;
  isDeletePending: boolean;
  isRunPending: boolean;
  onToggleStatus: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  const is_live = task.trigger_status === 'enabled';
  const is_done = task.trigger_status === 'completed';
  const status = status_label(task);
  const instruction = read_instruction(task);
  const run_count = read_run_count(task);

  return (
    <article className="flex min-h-48 flex-col rounded-xl border border-border bg-background p-3.5">
      <Link
        className="min-w-0"
        to="/scheduled-tasks/$trigger_id"
        params={{ trigger_id: task.trigger_id }}
      >
        <div className="line-clamp-2 font-medium text-foreground text-sm">{task.trigger_name}</div>
        <ScheduledTaskCardSchedule task={task} />
        <div className="mt-3 min-h-10 rounded-xl border border-border bg-sunken px-3 py-2 text-xs text-muted-foreground">
          <p className="line-clamp-2">{instruction || 'No instructions'}</p>
        </div>
      </Link>

      <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-muted-foreground">
        <span className={cn('size-2 rounded-full', status_dot_class(task.trigger_status))} />
        <span>{status}</span>
        {task.last_run_time ? (
          <span className="ml-auto">
            Last ran {relative_time(date_to_string(task.last_run_time) ?? '')}
          </span>
        ) : null}
        {run_count !== null ? (
          <span className="flex items-center gap-1">
            <Clock3 className="size-3" aria-hidden="true" />
            {run_count.toLocaleString()} {run_count === 1 ? 'run' : 'runs'}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
        {is_done ? null : (
          <Button
            className="mr-auto"
            disabled={!is_live || isRunPending}
            size="sm"
            type="button"
            variant="outline"
            onClick={onRun}
          >
            {isRunPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Run now
          </Button>
        )}
        {is_done ? null : (
          <ActionIconButton
            ariaLabel={is_live ? `Pause ${task.trigger_name}` : `Resume ${task.trigger_name}`}
            disabled={isStatusPending}
            isLoading={isStatusPending}
            icon={
              is_live ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )
            }
            onClick={onToggleStatus}
          />
        )}
        <DeleteTaskDialog
          taskName={task.trigger_name}
          disabled={isDeletePending}
          onConfirm={onDelete}
        />
      </div>
    </article>
  );
}

function DeleteTaskDialog({
  taskName,
  disabled,
  onConfirm,
}: {
  taskName: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            className="rounded-full bg-muted text-muted-foreground hover:bg-hover"
            disabled={disabled}
            size="icon-sm"
            type="button"
            variant="secondary"
            aria-label={`Delete ${taskName}`}
          >
            {disabled ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {taskName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops the schedule and removes the task. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActionIconButton({
  ariaLabel,
  disabled,
  icon,
  isLoading,
  onClick,
}: {
  ariaLabel: string;
  disabled?: boolean | undefined;
  icon: React.ReactNode;
  isLoading?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <Button
      className="rounded-full bg-muted text-muted-foreground hover:bg-hover"
      disabled={disabled}
      size="icon-sm"
      type="button"
      variant="secondary"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
    </Button>
  );
}

function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-4 text-sm text-destructive">
      <span>{label} unavailable.</span>
      <Button size="sm" type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-8 text-sm text-muted-foreground">
      <span>{title}.</span>
      {actionLabel && onAction ? (
        <Button size="sm" type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {loading_row_keys.map((key) => (
        <div className="min-h-48 rounded-xl border border-border p-3.5" key={key}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-4 w-36" />
          <Skeleton className="mt-3 h-10 w-full rounded-xl" />
          <Skeleton className="mt-8 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

function date_to_string(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function status_label(task: Trigger): string {
  if (task.trigger_status === 'completed') return 'Done';
  if (task.trigger_status === 'disabled') return 'Paused';
  if (task.trigger_status === 'error') return 'Needs attention';
  const run_once_at = read_run_once_at(task);
  const next = date_to_string(task.next_run_time) ?? date_to_string(run_once_at);
  return next ? `next ${relative_time(next)}` : 'Active';
}

function read_run_count(task: Trigger): number | null {
  const run_count = (task as Trigger & { run_count?: unknown }).run_count;
  return typeof run_count === 'number' && Number.isFinite(run_count) ? run_count : null;
}

function status_dot_class(status: string) {
  if (status === 'enabled') return 'bg-positive';
  if (status === 'error') return 'bg-destructive';
  return 'bg-muted-foreground';
}
