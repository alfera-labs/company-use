import type { Run } from '@/lib/api';

export function should_poll_runs(data: Run[] | undefined) {
  const latest_run = data?.[0];
  return Boolean(latest_run && ['queued', 'running'].includes(latest_run.run_status));
}
