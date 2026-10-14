import { format_error_message } from '@coworker/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type RefObject, useRef } from 'react';
import { toast } from 'sonner';
import { is_chat_run_active, session_status_from_run } from '@/components/app/chat_session_state';
import { upsert_run } from '@/components/app/chat_timeline';
import { cancel_run, list_session_runs, type Run, type Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

type StoppableRun = Pick<Run, 'run_id' | 'session_id' | 'run_status'>;

const run_start_wait_ms = 10_000;
const run_start_check_ms = 400;

async function wait_for_starting_run(
  query_client: QueryClient,
  session_id: string,
  deadline_ms: number,
): Promise<StoppableRun | undefined> {
  const [newest_run] = await query_client.fetchQuery({
    queryKey: query_keys.runs(session_id),
    queryFn: () => list_session_runs(session_id),
    staleTime: 0,
  });
  if (newest_run && is_chat_run_active(newest_run.run_status)) return newest_run;
  if (Date.now() >= deadline_ms) return undefined;
  await new Promise((resolve) => setTimeout(resolve, run_start_check_ms));
  return wait_for_starting_run(query_client, session_id, deadline_ms);
}

function show_run_as_stopping(query_client: QueryClient, run: StoppableRun) {
  query_client.setQueryData<Run[]>(query_keys.runs(run.session_id), (runs) =>
    runs?.map((item) =>
      item.run_id === run.run_id && !item.cancel_requested_time
        ? { ...item, cancel_requested_time: new Date().toISOString() }
        : item,
    ),
  );
}

function show_run_as_stopped(query_client: QueryClient, cancelled: Run) {
  query_client.setQueryData<Run[]>(query_keys.runs(cancelled.session_id), (runs) =>
    upsert_run(runs, cancelled),
  );
  void query_client.invalidateQueries({ queryKey: query_keys.messages(cancelled.session_id) });
  const session_status = session_status_from_run(cancelled);
  if (!session_status) return;
  query_client.setQueryData<Session[]>(query_keys.sessions(), (sessions) =>
    sessions?.map((session) =>
      session.session_id === cancelled.session_id ? { ...session, session_status } : session,
    ),
  );
}

/**
 * Stops the run the chat works on. A stop pressed right after a send comes before the run exists:
 * the stop then waits for that run and stops it, so no stop is lost. One stop is in flight for a
 * run at a time.
 */
export function useStopChatRun({
  session_id,
  run,
  is_submitting,
  stream_abort_ref,
  stream_session_id_ref,
}: {
  session_id: string | undefined;
  run: StoppableRun | undefined;
  is_submitting: boolean;
  stream_abort_ref: RefObject<AbortController | null>;
  stream_session_id_ref: RefObject<string | undefined>;
}) {
  const query_client = useQueryClient();
  const stops_in_flight = useRef(new Map<string, Promise<boolean>>());

  async function cancel_active_run(active_run: StoppableRun) {
    const controller =
      stream_session_id_ref.current === active_run.session_id ? stream_abort_ref.current : null;
    show_run_as_stopping(query_client, active_run);
    const cancelled = await cancel_run(active_run.run_id);
    if (is_chat_run_active(cancelled.run_status))
      throw new Error('The task is still stopping. Try again.');
    controller?.abort();
    if (stream_abort_ref.current === controller) stream_abort_ref.current = null;
    show_run_as_stopped(query_client, cancelled);
  }

  async function stop_run_or_the_one_that_starts(known_run: StoppableRun | undefined) {
    try {
      const active_run =
        known_run ??
        (session_id
          ? await wait_for_starting_run(query_client, session_id, Date.now() + run_start_wait_ms)
          : undefined);
      if (!active_run) throw new Error('The task is still starting. Try stopping it again.');
      await cancel_active_run(active_run);
      return true;
    } catch (error) {
      toast.error(format_error_message(error, 'The run could not be stopped.'));
      void query_client.invalidateQueries({ queryKey: query_keys.runs(session_id) });
      return false;
    }
  }

  return async function stop_current_run() {
    const known_run = run && is_chat_run_active(run.run_status) ? run : undefined;
    if (!known_run && !is_submitting) return true;
    const stop_key = known_run?.run_id ?? `starting:${session_id}`;
    const stop_in_flight = stops_in_flight.current.get(stop_key);
    if (stop_in_flight) return stop_in_flight;
    const stop = stop_run_or_the_one_that_starts(known_run).finally(() =>
      stops_in_flight.current.delete(stop_key),
    );
    stops_in_flight.current.set(stop_key, stop);
    return stop;
  };
}
