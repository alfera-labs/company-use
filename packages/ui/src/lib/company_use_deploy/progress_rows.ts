import {
  type ProgressReport,
  server_address_pattern,
} from '@coworker/ui/lib/company_use_deploy/deploy_schemas';
import { progress_row_titles } from '@coworker/ui/lib/company_use_deploy/deploy_words';

type RowKey = keyof typeof progress_row_titles;
export type RowState = 'waiting' | 'live' | 'done';
export type ProgressRow = { key: RowKey; title: string; state: RowState; seconds: number | null };
export type ProgressOutcome =
  | { kind: 'working' }
  | { kind: 'done'; address: string }
  | { kind: 'failed'; box_reason: string | null }
  | { kind: 'silent' };

const whole_install_step = 'install';
const most_quiet_milliseconds = 20 * 60 * 1000;

export const row_records: { key: RowKey; steps: readonly string[] }[] = [
  { key: 'server', steps: [] },
  { key: 'prepare', steps: ['arguments', 'tools', 'docker', 'machine', 'address'] },
  {
    key: 'download',
    steps: ['source', 'settings', 'images', 'api_image', 'app_image', 'sandbox_image'],
  },
  { key: 'start', steps: ['start', 'api', 'dashboard'] },
  { key: 'secure', steps: ['https'] },
];

const row_keys = row_records.map((record) => record.key);

const row_of = (step: string): RowKey =>
  row_records.find((record) => record.steps.includes(step))?.key ?? 'prepare';

function start_times(reports: ProgressReport[], started_at: number) {
  const times = new Map<RowKey, number>([['server', started_at]]);
  for (const report of reports.filter((r) => r.step !== whole_install_step)) {
    const key = row_of(report.step);
    const at = Date.parse(report.at);
    if (!times.has(key) || at < (times.get(key) ?? at)) times.set(key, at);
  }
  if (reports.length > 0) {
    times.set(
      'prepare',
      Math.min(times.get('prepare') ?? Infinity, ...reports.map((r) => Date.parse(r.at))),
    );
  }
  return times;
}

export function read_outcome(
  reports: ProgressReport[],
  started_at: number,
  now: number,
  minutes_before_the_first_report = 20,
): ProgressOutcome {
  const finished = reports.find((r) => r.step === whole_install_step && r.state === 'done');
  if (finished?.address && server_address_pattern.test(finished.address)) {
    return { kind: 'done', address: finished.address };
  }
  const failed = reports.find((r) => r.state === 'failed');
  if (failed) return { kind: 'failed', box_reason: failed.reason };
  const quiet_limit =
    reports.length > 0 ? most_quiet_milliseconds : minutes_before_the_first_report * 60_000;
  const last_heard = Math.max(started_at, ...reports.map((r) => Date.parse(r.at)));
  return now - last_heard > quiet_limit ? { kind: 'silent' } : { kind: 'working' };
}

export function build_progress_rows(
  reports: ProgressReport[],
  started_at: number,
  now: number,
): ProgressRow[] {
  const starts = start_times(reports, started_at);
  const is_finished = read_outcome(reports, started_at, now).kind === 'done';
  return row_keys.map((key, index) => {
    const start = starts.get(key);
    const next_start = row_keys
      .slice(index + 1)
      .map((later) => starts.get(later))
      .find(Boolean);
    const end =
      next_start ?? (is_finished ? Math.max(...reports.map((r) => Date.parse(r.at))) : null);
    const state: RowState = start === undefined ? 'waiting' : end === null ? 'live' : 'done';
    const seconds =
      start === undefined ? null : Math.max(0, Math.round(((end ?? now) - start) / 1000));
    return { key, title: progress_row_titles[key], state, seconds };
  });
}
