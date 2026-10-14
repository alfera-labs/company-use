import { type Database, event_jobs as event_jobs_table } from '@coworker/core';
import { and, eq, inArray } from 'drizzle-orm';

export type SlackChannelSweepResult = {
  channel_id?: string;
  channel_label?: string;
  messages_scanned?: number;
  threads_scanned?: number;
  scan_truncated?: boolean;
  digest_text?: string | null;
  discovery_oldest_ts?: string | null;
  discovery_latest_ts?: string | null;
};

export type ChannelSweepJob = {
  job_status: string;
  result_data: SlackChannelSweepResult | null;
};

export async function list_channel_sweep_jobs(
  db: Database,
  input: { workspace_id: string; channel_subject_keys: string[] },
) {
  if (input.channel_subject_keys.length === 0) return [];
  return db
    .select()
    .from(event_jobs_table)
    .where(
      and(
        eq(event_jobs_table.workspace_id, input.workspace_id),
        inArray(event_jobs_table.queue_key, input.channel_subject_keys),
      ),
    );
}

export function summarize_channel_sweep(jobs: ChannelSweepJob[]) {
  const results = jobs.map((job) => job.result_data ?? {});
  return {
    channels_scanned: jobs.length,
    messages_scanned: sum(results, (result) => result.messages_scanned),
    threads_scanned: sum(results, (result) => result.threads_scanned),
    channels_with_a_digest: results.filter((result) => Boolean(result.digest_text)).length,
    failed_channels: jobs.filter((job) => job.job_status === 'failed' || job.job_status === 'dead')
      .length,
    scanned_from: earliest_scanned_date(results),
  };
}

export function channel_digest_lines(jobs: ChannelSweepJob[]) {
  return jobs.flatMap((job) => {
    const result = job.result_data;
    if (!result?.digest_text) return [];
    const label = result.channel_label ?? result.channel_id ?? 'a channel';
    return [`${label}:\n${result.digest_text}`];
  });
}

function earliest_scanned_date(results: SlackChannelSweepResult[]): Date | null {
  const times = results
    .map((result) => slack_ts_to_millis(result.discovery_oldest_ts))
    .filter((millis): millis is number => millis !== null);
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

function slack_ts_to_millis(message_ts: string | null | undefined): number | null {
  if (!message_ts) return null;
  const seconds = Number.parseFloat(message_ts);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function sum(
  results: SlackChannelSweepResult[],
  read: (result: SlackChannelSweepResult) => number | undefined,
) {
  return results.reduce((total, result) => total + (read(result) ?? 0), 0);
}
