import type { ConnectedAppTimes } from '@/components/app/chat_connection_dock';
import type { Run } from '@/lib/api';

export const resumed_run_watch_ms = 30_000;

const active_run_statuses = ['queued', 'starting', 'running', 'waiting'] as const;
const terminal_run_statuses = ['completed', 'failed', 'blocked', 'timed_out', 'cancelled'] as const;

export function is_chat_run_active(status: string | null | undefined) {
  return active_run_statuses.includes(status as (typeof active_run_statuses)[number]);
}

export function is_chat_run_terminal(status: string | null | undefined) {
  return terminal_run_statuses.includes(status as (typeof terminal_run_statuses)[number]);
}

export function session_status_from_run(run: Run) {
  if (is_chat_run_active(run.run_status)) return 'running';
  if (run.run_status === 'completed') return 'completed';
  if (run.run_status === 'failed') return 'failed';
  if (run.run_status === 'cancelled') return 'cancelled';
  return null;
}

export function should_keep_chat_submitting(input: {
  isMutationPending: boolean;
  isMessageWaitingToStart?: boolean;
  latestRunStartedThisSend?: boolean;
  latestRunStatus?: string | null | undefined;
  selectedSessionStatus?: string | null | undefined;
}) {
  if (is_chat_run_active(input.latestRunStatus)) return true;
  if (input.isMessageWaitingToStart) return true;
  const latest_run_started_this_send = input.latestRunStartedThisSend ?? true;
  if (is_chat_run_terminal(input.latestRunStatus) && latest_run_started_this_send) return false;
  return input.isMutationPending || input.selectedSessionStatus === 'running';
}

export function has_newly_connected_app(
  previous: ConnectedAppTimes | undefined,
  next: ConnectedAppTimes | undefined,
) {
  if (!previous || !next) return false;
  return Object.entries(next).some(([app_key, connected_ms]) => {
    const previous_ms = previous[app_key];
    return previous_ms === undefined || connected_ms > previous_ms;
  });
}

export function should_show_chat_session_loading(input: {
  isMessagesLoading: boolean;
  isMutationPending: boolean;
  messageCount: number;
  sessionId?: string | null | undefined;
}) {
  return Boolean(
    input.sessionId &&
      input.isMessagesLoading &&
      input.messageCount === 0 &&
      !input.isMutationPending,
  );
}
