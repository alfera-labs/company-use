import { randomUUID } from 'node:crypto';
import { describe_session_messages_not_sent } from '@api/services/sessions/session_message_not_sent';
import { build_session_message_payload } from '@api/services/sessions/session_message_payload';
import type { SessionMessageRequest } from '@api/services/sessions/session_message_request';
import {
  describe_waiting_jobs,
  describe_waiting_session_messages,
  read_waiting_session_jobs,
  type WaitingSessionJobs,
} from '@api/services/sessions/session_message_waiting_reasons';
import type { Database } from '@coworker/core';
import { find_event_by_source_id, find_event_with_jobs } from '@coworker/core/db/queries/events';
import {
  cancel_waiting_session_message,
  find_session_message_job,
} from '@coworker/core/db/queries/session_message_queue';
import { dismiss_session_message_not_sent } from '@coworker/core/db/queries/session_messages_not_sent';
import { get_session_for_user } from '@coworker/core/db/queries/sessions';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import {
  check_run_start_credit_gates,
  find_event_job_handler,
  session_message_attachment_count,
  session_message_event_source,
  session_message_preview_text,
  session_message_sent_event_type,
} from '@coworker/runtime-platform';
import {
  ConflictError,
  NotFoundError,
  session_agent_message_job_handler,
  session_queue_key,
  session_queue_resumed_event_type,
} from '@coworker/shared';

type SessionScope = { workspace_id: string; session_id: string; user_id: string };

export type SendSessionMessageInput = SessionScope & {
  client_message_id: string;
  body: SessionMessageRequest;
  multipart_files?: ReadonlyMap<string, File>;
  repeats_run_message_id?: string;
};

export async function send_session_message(db: Database, input: SendSessionMessageInput) {
  const [open_session, existing, credit_gates, waiting_before] = await Promise.allSettled([
    require_open_session(db, input),
    find_sent_message_job(db, input),
    check_run_start_credit_gates(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      actor_id: input.user_id,
      model_provider: input.body.model_provider,
      model_proxy: input.body.model_proxy,
      model_name: input.body.model_name,
    }),
    read_waiting_session_jobs(db, input),
  ]);
  if (open_session.status === 'rejected') throw open_session.reason;
  if (existing.status === 'rejected') throw existing.reason;
  if (waiting_before.status === 'rejected') throw waiting_before.reason;
  if (existing.value) return describe_sent_message(existing.value, false, waiting_before.value);
  if (credit_gates.status === 'rejected') throw credit_gates.reason;
  const created_job = await queue_session_message_job(db, input);
  if (created_job) return describe_sent_message(created_job, true, waiting_before.value);
  const raced = await find_sent_message_job(db, input);
  if (!raced) throw new Error('The message event exists but its job was not found.');
  return describe_sent_message(raced, false, waiting_before.value);
}

type SentMessageJob = WaitingSessionJobs['jobs'][number];

function describe_sent_message(
  job: SentMessageJob,
  created: boolean,
  waiting_before: WaitingSessionJobs,
) {
  const jobs = created ? [...waiting_before.jobs, job] : waiting_before.jobs;
  const described = describe_waiting_jobs({ ...waiting_before, jobs });
  const waiting_reason =
    described.find((message) => message.job_id === job.job_id)?.waiting_reason ?? null;
  return { job, created, waiting_reason };
}

async function queue_session_message_job(db: Database, input: SendSessionMessageInput) {
  const payload = await build_session_message_payload(db, input);
  const preview_text = session_message_preview_text(payload);
  const attachment_count = session_message_attachment_count(payload);
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: session_message_event_source,
      source_event_id: sent_message_event_id(input),
      event_type: session_message_sent_event_type,
      queue_key: session_queue_key(input.session_id),
      actor_key: input.user_id,
      event_body: payload,
      metadata: { preview_text, attachment_count },
      event_jobs: [
        {
          job_handler: session_agent_message_job_handler,
          metadata: {
            blocks_later_subject_jobs: true,
            claimed_alone: true,
            client_message_id: input.client_message_id,
            repeats_run_message_id: input.repeats_run_message_id,
            preview_text,
            attachment_count,
          },
        },
      ],
    },
    find_event_job_handler,
  );
  return result.event_jobs.find((job) => job.job_handler === session_agent_message_job_handler);
}

export async function list_queued_session_messages(db: Database, input: SessionScope) {
  const [, waiting, not_sent] = await Promise.all([
    require_open_session(db, input),
    describe_waiting_session_messages(db, input),
    describe_session_messages_not_sent(db, input),
  ]);
  return [...waiting, ...not_sent].sort(
    (left, right) =>
      left.created_time.getTime() - right.created_time.getTime() ||
      left.job_id.localeCompare(right.job_id),
  );
}

export async function remove_queued_session_message(
  db: Database,
  input: SessionScope & { job_id: string },
) {
  await require_open_session(db, input);
  const scope = { ...input, actor_id: input.user_id };
  const removed =
    (await cancel_waiting_session_message(db, scope)) ??
    (await dismiss_session_message_not_sent(db, scope));
  if (removed) return removed;
  const job = await find_session_message_job(db, input);
  if (!job) throw new NotFoundError('Queued message');
  if (job.job_status === 'cancelled') return job;
  throw new ConflictError('This message already started, so it can no longer be removed.', {
    job_id: job.job_id,
    job_status: job.job_status,
  });
}

export async function resume_paused_session_messages(db: Database, input: SessionScope) {
  await require_open_session(db, input);
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: session_message_event_source,
      source_event_id: `${input.session_id}:resume:${randomUUID()}`,
      event_type: session_queue_resumed_event_type,
      queue_key: session_queue_key(input.session_id),
      actor_key: input.user_id,
    },
    find_event_job_handler,
  );
  return { resumed_job_ids: result.event_jobs.map((job) => job.job_id) };
}

async function require_open_session(db: Database, input: SessionScope) {
  const session = await get_session_for_user(db, input);
  if (!session) throw new NotFoundError('Session');
  if (session.session_status === 'deleted') {
    throw new ConflictError('This chat was deleted, so it takes no new messages.');
  }
  return session;
}

async function find_sent_message_job(
  db: Database,
  input: { workspace_id: string; session_id: string; client_message_id: string },
) {
  const event = await find_event_by_source_id(db, {
    workspace_id: input.workspace_id,
    source: session_message_event_source,
    source_event_id: sent_message_event_id(input),
  });
  if (!event) return null;
  const found = await find_event_with_jobs(db, {
    workspace_id: input.workspace_id,
    event_id: event.event_id,
  });
  return (
    found?.event_jobs.find((job) => job.job_handler === session_agent_message_job_handler) ?? null
  );
}

export function sent_message_event_id(input: { session_id: string; client_message_id: string }) {
  return `${input.session_id}:${input.client_message_id}`;
}
