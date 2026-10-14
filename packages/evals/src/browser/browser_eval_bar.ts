import type { BrowserEvalReport } from '@coworker/evals/browser/browser_eval_types';

export type BrowserBarCheck = {
  name: string;
  read: (report: BrowserEvalReport) => number;
  at_least?: number;
  at_most?: number;
  format: 'rate' | 'ms' | 'count';
};

export const browser_eval_bar: readonly BrowserBarCheck[] = [
  {
    name: 'cooperative smoke pass rate',
    read: (report) => report.cooperative_smoke_pass_rate,
    at_least: 0.9,
    format: 'rate',
  },
  {
    name: 'realistic pass rate',
    read: (report) => report.realistic_pass_rate,
    at_least: 0.4,
    format: 'rate',
  },
  {
    name: 'act-then-verify catch rate',
    read: (report) => report.act_then_verify_catch_rate,
    at_least: 0.9,
    format: 'rate',
  },
  {
    name: 'median action round-trip',
    read: (report) => report.median_action_round_trip_ms,
    at_most: 1500,
    format: 'ms',
  },
  {
    name: 'median tokens per task',
    read: (report) => report.median_tokens_per_task,
    at_most: 5000,
    format: 'count',
  },
  {
    name: 'sandbox create to first snapshot',
    read: (report) => report.median_create_to_first_snapshot_ms,
    at_most: 10_000,
    format: 'ms',
  },
];

export type BrowserBarResult = {
  name: string;
  passed: boolean;
  value: number;
  threshold: string;
};

export function check_browser_eval_bar(report: BrowserEvalReport): {
  passed: boolean;
  results: BrowserBarResult[];
} {
  const results = browser_eval_bar.map((check) => {
    const value = check.read(report);
    const passed =
      (check.at_least === undefined || value >= check.at_least) &&
      (check.at_most === undefined || value <= check.at_most);
    return { name: check.name, passed, value, threshold: describe_threshold(check) };
  });
  return { passed: results.every((result) => result.passed), results };
}

function describe_threshold(check: BrowserBarCheck): string {
  if (check.at_least !== undefined) return `>= ${format_value(check.at_least, check.format)}`;
  if (check.at_most !== undefined) return `<= ${format_value(check.at_most, check.format)}`;
  return 'n/a';
}

export function format_value(value: number, format: BrowserBarCheck['format']): string {
  if (format === 'rate') return `${Math.round(value * 100)}%`;
  if (format === 'ms') return `${Math.round(value)}ms`;
  return `${Math.round(value)}`;
}
