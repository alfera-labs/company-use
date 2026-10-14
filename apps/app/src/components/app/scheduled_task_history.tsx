import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCheck, Info } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  list_trigger_runs,
  mark_trigger_runs_read,
  relative_time,
  type TriggerRunHistoryItem,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/** One page of the runs of a task, read again every 5 seconds so a run that just started shows. */
export function trigger_runs_page_query(trigger_id: string, page: number) {
  return {
    queryKey: query_keys.trigger_runs(trigger_id, page),
    queryFn: () => list_trigger_runs(trigger_id, { page, page_size: 20 }),
    refetchInterval: 5_000,
  };
}

export function ScheduledTaskHistory({ triggerId }: { triggerId: string }) {
  const query_client = useQueryClient();
  const [page, set_page] = useState(1);
  const history_query = useQuery(trigger_runs_page_query(triggerId, page));
  const mark_read = useMutation({
    mutationFn: () => mark_trigger_runs_read(triggerId),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.trigger_runs(triggerId) });
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not mark the runs as read')),
  });
  const history = history_query.data;
  const has_unread = history?.items.some((run) => run.is_unread) ?? false;
  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <div className="flex h-11 items-center gap-2 border-b px-4">
        <h2 className="text-sm font-medium">History</h2>
        <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {has_unread ? (
            <Button
              className="h-auto gap-1 px-0 text-xs"
              disabled={mark_read.isPending}
              type="button"
              variant="ghost"
              onClick={() => mark_read.mutate()}
            >
              <CheckCheck className="size-3.5" />
              Mark all as read
            </Button>
          ) : null}
          {history ? (
            <span>{history.total_count === 1 ? '1 run' : `${history.total_count} runs`}</span>
          ) : null}
        </div>
      </div>
      {history_query.isLoading ? (
        <HistoryLoading />
      ) : history_query.isError ? (
        <div className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground">
          <span>Could not load the run history.</span>
          <Button size="sm" variant="outline" onClick={() => void history_query.refetch()}>
            Retry
          </Button>
        </div>
      ) : history?.items.length ? (
        <>
          <ol className="divide-y">
            {history.items.map((run) => (
              <HistoryRow key={run.run_id} run={run} />
            ))}
          </ol>
          {history.total_count > history.page_size ? (
            <div className="flex justify-end gap-2 border-t p-2">
              <Button
                disabled={page === 1}
                size="sm"
                variant="ghost"
                onClick={() => set_page((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                disabled={page * history.page_size >= history.total_count}
                size="sm"
                variant="ghost"
                onClick={() => set_page((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No runs yet.</p>
      )}
    </section>
  );
}

function HistoryRow({ run }: { run: TriggerRunHistoryItem }) {
  const outcome = run.error_message || status_label(run.run_status);
  const time = run.finished_time ?? run.started_time ?? run.created_time;
  return (
    <li>
      <Link
        className="grid min-h-10 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm hover:bg-hover"
        to="/chats/{-$session_id}"
        params={{ session_id: run.session_id }}
      >
        <span className={cn('size-1.5 rounded-full', status_dot(run))} aria-hidden="true" />
        <span className="font-medium tabular-nums">Run #{run.run_number}</span>
        <span className="truncate text-muted-foreground">{outcome}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {relative_time(time)}
        </span>
      </Link>
    </li>
  );
}

function status_label(status: string) {
  const labels: Record<string, string> = {
    blocked: 'Blocked',
    cancelled: 'Stopped',
    completed: 'Completed',
    failed: 'Failed',
    queued: 'Queued',
    running: 'Running',
    starting: 'Starting',
    timed_out: 'Timed out',
    waiting: 'Waiting',
  };
  return labels[status] ?? status;
}

function status_dot(run: TriggerRunHistoryItem) {
  if (run.is_unread) return 'bg-primary';
  if (run.run_status === 'completed') return 'bg-emerald-500';
  if (['failed', 'blocked', 'timed_out'].includes(run.run_status)) return 'bg-amber-500';
  if (['queued', 'starting', 'running', 'waiting'].includes(run.run_status)) return 'bg-blue-500';
  return 'bg-muted-foreground/50';
}

function HistoryLoading() {
  return (
    <div className="space-y-3 p-4">
      {['one', 'two', 'three', 'four'].map((key) => (
        <Skeleton className="h-5 w-full" key={key} />
      ))}
    </div>
  );
}
