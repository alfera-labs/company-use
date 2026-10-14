import type { Database } from '@coworker/core';
import {
  is_session_busy,
  list_waiting_session_messages,
} from '@coworker/core/db/queries/session_message_queue';

export type QueuedMessageWaitingReason =
  | 'starting'
  | 'session_busy'
  | 'waiting_for_credit'
  | 'retrying'
  | 'paused';

export type QueuedSessionMessage = {
  job_id: string;
  client_message_id: string | null;
  preview_text: string;
  attachment_count: number;
  created_time: Date;
  state: 'queued' | 'paused';
  waiting_reason: QueuedMessageWaitingReason;
  run_id?: string;
  repeats_run_message_id?: string;
};

type WaitingJob = Awaited<ReturnType<typeof list_waiting_session_messages>>[number];

export type WaitingSessionJobs = { jobs: WaitingJob[]; session_busy: boolean };

export async function read_waiting_session_jobs(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<WaitingSessionJobs> {
  const [jobs, session_busy] = await Promise.all([
    list_waiting_session_messages(db, input),
    is_session_busy(db, input),
  ]);
  return { jobs, session_busy };
}

export async function describe_waiting_session_messages(
  db: Database,
  input: { workspace_id: string; session_id: string },
): Promise<QueuedSessionMessage[]> {
  return describe_waiting_jobs(await read_waiting_session_jobs(db, input));
}

export function describe_waiting_jobs({
  jobs,
  session_busy,
}: WaitingSessionJobs): QueuedSessionMessage[] {
  const now = new Date();
  let queued_ahead = false;
  return jobs.map((job) => {
    const waiting_reason = read_waiting_reason(job, now, session_busy || queued_ahead);
    if (job.job_status === 'queued') queued_ahead = true;
    return describe_job(job, waiting_reason);
  });
}

function read_waiting_reason(
  job: WaitingJob,
  now: Date,
  waits_for_session: boolean,
): QueuedMessageWaitingReason {
  if (job.job_status === 'waiting') return 'paused';
  if (typeof job.result_data.held_for_credit_top_up_since === 'string') return 'waiting_for_credit';
  if (job.attempt_count > 0 && job.available_time > now) return 'retrying';
  return waits_for_session ? 'session_busy' : 'starting';
}

function describe_job(
  job: WaitingJob,
  waiting_reason: QueuedMessageWaitingReason,
): QueuedSessionMessage {
  return {
    job_id: job.job_id,
    client_message_id: job.metadata.client_message_id ?? null,
    preview_text: job.metadata.preview_text ?? '',
    attachment_count: job.metadata.attachment_count ?? 0,
    created_time: job.created_time,
    state: job.job_status === 'waiting' ? 'paused' : 'queued',
    waiting_reason,
    ...(job.run_id ? { run_id: job.run_id } : {}),
    ...read_repeated_message_id(job.metadata),
  };
}

/** The stored message a queued job runs again, when the job is a repeat and not a new message. */
export function read_repeated_message_id(job_metadata: Record<string, unknown>) {
  const run_message_id = job_metadata.repeats_run_message_id;
  return typeof run_message_id === 'string' ? { repeats_run_message_id: run_message_id } : {};
}
