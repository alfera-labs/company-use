import type { Session } from '@/lib/api/types';

export type SidebarActivityInput = Pick<
  Session,
  'session_status' | 'last_message_time' | 'last_updated_time' | 'created_time'
> & {
  latest_run?: Session['latest_run'];
};

const active_run_labels: Record<string, string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Working',
  waiting: 'Waiting',
};
const terminal_run_labels: Record<string, string> = {
  failed: 'Failed',
  cancelled: 'Stopped',
  expired: 'Expired',
};

export function sidebar_chat_is_active(session: SidebarActivityInput): boolean {
  return (
    session.session_status === 'running' ||
    Boolean(active_run_labels[session.latest_run?.run_status ?? ''])
  );
}

export function read_sidebar_chat_activity(session: SidebarActivityInput, now = Date.now()) {
  const run = session.latest_run;
  const active_label = run && active_run_labels[run.run_status];
  if (run && active_label)
    return {
      label: active_label,
      description: active_label,
      working: run.run_status === 'running',
    };
  if (session.session_status === 'running')
    return { label: 'Working', description: 'Working', working: true };
  const terminal_label = run && terminal_run_labels[run.run_status];
  if (run && terminal_label)
    return {
      label: terminal_label,
      description: describe_time(terminal_label, run.finished_time),
      working: false,
    };
  if (run?.run_status === 'completed') {
    return {
      label: compact_age(run.finished_time, now) ?? 'Finished',
      description: describe_time('Finished', run.finished_time),
      working: false,
    };
  }
  if (run) return { label: 'Unknown', description: 'Run status unavailable', working: false };
  const activity_time = session.last_message_time ?? session.created_time;
  return {
    label: compact_age(activity_time, now) ?? 'New',
    description: describe_time(session.last_message_time ? 'Updated' : 'Created', activity_time),
    working: false,
  };
}

function compact_age(value: string | null | undefined, now: number): string | null {
  if (!value) return null;
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function describe_time(label: string, value: string | null | undefined): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return `${label} time unavailable`;
  return `${label} ${utc_time_format.format(new Date(value))}`;
}

const utc_time_format = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'long',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
