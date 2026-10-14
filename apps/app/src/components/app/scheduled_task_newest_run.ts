// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { trigger_runs_page_query } from '@/components/app/scheduled_task_history';
import { relative_time, type TriggerRunHistoryItem } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const states_of_a_run_in_progress = ['queued', 'starting', 'running', 'waiting'];

/**
 * The newest run of a scheduled task, read again every few seconds: undefined until the runs
 * are read, null when the task has none. When a run appears or changes its state, the lists
 * that show it are read again: the tasks (the time of the last run) and the chats (the chat
 * of the run), so neither waits for a reload of the page.
 */
export function use_newest_scheduled_task_run(trigger_id: string) {
  const query_client = useQueryClient();
  const runs = useQuery(trigger_runs_page_query(trigger_id, 1)).data;
  const newest_run = runs ? (runs.items[0] ?? null) : undefined;
  const run_state = newest_run ? `${newest_run.run_id}:${newest_run.run_status}` : null;
  useEffect(() => {
    if (!run_state) return;
    void query_client.invalidateQueries({ queryKey: query_keys.triggers() });
    void query_client.invalidateQueries({ queryKey: query_keys.sessions() });
  }, [run_state, query_client]);
  return newest_run;
}

/**
 * What the page of a task says about its last run. "Last ran" is the end of a run the page
 * has read, never the time the task holds: that one is the moment a run was asked for, so it
 * is there before the run has even started. Until the runs are read, a task that was asked to
 * run says nothing.
 */
export function last_run_words(
  time_a_run_was_last_asked_for: string | null | undefined,
  newest_run: TriggerRunHistoryItem | null | undefined,
) {
  if (newest_run === undefined) return time_a_run_was_last_asked_for ? '' : 'No runs yet';
  if (!newest_run) return 'No runs yet';
  if (states_of_a_run_in_progress.includes(newest_run.run_status)) return 'Running now';
  const ended = newest_run.finished_time ?? newest_run.started_time ?? newest_run.created_time;
  return `Last ran ${relative_time(ended)}`;
}
