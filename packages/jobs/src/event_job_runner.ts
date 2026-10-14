import { randomUUID } from 'node:crypto';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { type EnqueueEventInput, enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { list_runs_still_in_progress } from '@coworker/core/db/queries/sessions';
import {
  EventJobClaimLostError,
  log_lost_event_job_claim,
} from '@coworker/jobs/event_job_claim_lost';
import {
  ring_queue_doorbell,
  uses_rivet_event_job_dispatch,
} from '@coworker/jobs/event_job_doorbell';
import { read_event_job_failure } from '@coworker/jobs/event_job_failure';
import type {
  EventJobHandlerControls,
  EventJobHandlerResult,
  FindEventJobHandler,
  LiveEventPublisher,
} from '@coworker/jobs/event_job_handler';
import { type EventJobLease, start_lease_heartbeat } from '@coworker/jobs/event_job_lease';
import {
  count_label,
  format_duration,
  queue_label,
  when_it_runs,
} from '@coworker/jobs/event_job_log_labels';
import {
  is_transient_provider_error,
  resolve_retry_for_failed_job,
} from '@coworker/jobs/event_job_retry';
import { refuse_job_runs_outside_the_queue_worker } from '@coworker/jobs/event_job_runner_host';
import { run_counted_in_a_queue_run_slot } from '@coworker/jobs/event_job_statement_count';
import {
  claim_next_ready_event_jobs,
  claim_ready_event_jobs_for_queue,
} from '@coworker/jobs/queries/event_job_claims';
import {
  release_event_job_claims,
  save_event_job_result,
  set_event_jobs_run_id,
} from '@coworker/jobs/queries/event_job_leases';
import { save_event_job_progress } from '@coworker/jobs/queries/event_job_progress';
import {
  event_job_queue_barrier_metadata_key,
  find_active_event_job_for_queue,
  find_latest_queued_barrier_time_for_queue,
  find_latest_queued_job_time_for_queue,
  find_next_queued_event_job_for_queue,
  list_events_for_event_jobs,
} from '@coworker/jobs/queries/event_job_reads';
import { create_logger } from '@coworker/shared';

const log = create_logger('event_job_runner');
const runner_instance_id = randomUUID();
const blocked_queue_retry_ms = 1_000;
export const max_event_job_request_delay_ms = 10_000;
type EventJob = Awaited<ReturnType<typeof claim_ready_event_jobs_for_queue>>[number];
type EventRecord = Awaited<ReturnType<typeof list_events_for_event_jobs>>[number];

export type EventJobErrorContext = {
  workspace_id: string;
  queue_key: string;
  job_handler: string;
  job_ids: string[];
  run_ids: string[];
  error_code?: string;
  safe_tags?: Record<string, string>;
};

type EventJobErrorReporter = (error: unknown, context: EventJobErrorContext) => void;

let event_job_error_reporter: EventJobErrorReporter | undefined;

export function configure_event_job_error_reporter(reporter: EventJobErrorReporter) {
  event_job_error_reporter = reporter;
}

export type EventJobRequest =
  | { workspace_id: string; queue_key: string; delay_ms?: number | undefined }
  | { run_recovery: true }
  | Record<string, never>;

export async function queue_and_run_event_jobs(
  db: Database,
  event: EnqueueEventInput,
  find_event_job_handler: FindEventJobHandler,
) {
  const result = await enqueue_event_jobs(db, event);
  for (const [queue_key, jobs] of group_jobs_by_queue(result.event_jobs)) {
    await start_queue_jobs(
      db,
      { workspace_id: event.workspace_id, queue_key, jobs },
      find_event_job_handler,
    );
  }
  return result;
}

function group_jobs_by_queue<T extends { queue_key: string }>(jobs: T[]) {
  const groups = new Map<string, T[]>();
  for (const job of jobs) groups.set(job.queue_key, [...(groups.get(job.queue_key) ?? []), job]);
  return groups;
}

async function start_queue_jobs(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    jobs: Array<{ job_id: string; job_status: string; available_time: Date }>;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  const delay_ms = delay_ms_until_first_job_is_ready(input.jobs);
  const job_ids = input.jobs.filter((job) => job.job_status === 'queued').map((job) => job.job_id);
  const run_input = { workspace_id: input.workspace_id, queue_key: input.queue_key, delay_ms };
  const dispatch_over_http =
    uses_http_event_job_dispatch() && delay_ms <= max_event_job_request_delay_ms;
  const deferred_to_recovery = uses_http_event_job_dispatch() && !dispatch_over_http;

  log.info(
    `queued ${count_label(input.jobs.length, 'job')} for ${queue_label(input.queue_key, input.workspace_id)} — ${when_it_runs(delay_ms, deferred_to_recovery)}`,
  );

  if (dispatch_over_http) {
    await start_queue_event_job_request(run_input);
  } else {
    run_queue_jobs_in_the_background(db, { ...run_input, job_ids }, find_event_job_handler);
  }
}

export function delay_ms_until_first_job_is_ready(jobs: Array<{ available_time: Date }>) {
  if (jobs.length === 0) return 0;
  const next_time = Math.min(...jobs.map((job) => job.available_time.getTime()));
  return Math.max(next_time - Date.now(), 0);
}

export function run_queue_jobs_in_the_background(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    delay_ms?: number;
    job_ids?: string[];
  },
  find_event_job_handler: FindEventJobHandler,
) {
  if (uses_rivet_event_job_dispatch()) {
    void ring_queue_doorbell(db, input);
    return;
  }

  if (uses_http_event_job_dispatch()) {
    if ((input.delay_ms ?? 0) > max_event_job_request_delay_ms) {
      return;
    }

    const dispatched = request_queued_event_jobs({
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      ...(input.delay_ms === undefined ? {} : { delay_ms: input.delay_ms }),
    });
    if (!dispatched) {
      log.error('Queued jobs could not be dispatched to an API request', {
        api_url: env.API_URL,
        workspace_id: input.workspace_id,
        queue_key: input.queue_key,
      });
    }
    return;
  }

  const delay_ms = Math.max(input.delay_ms ?? 0, 0);
  setTimeout(() => {
    run_queue_jobs(db, input, find_event_job_handler).catch((error) => {
      log.error('Running queue jobs failed', {
        workspace_id: input.workspace_id,
        queue_key: input.queue_key,
        error: error_message(error),
      });
    });
  }, delay_ms);
}

function request_queued_event_jobs(job_request: EventJobRequest = {}) {
  const event_job_request = build_event_job_request(job_request);
  if (!event_job_request) return false;
  void launch_event_job_request(event_job_request).catch(log_event_job_request_failure);
  return true;
}

export async function start_event_job_request(job_request: EventJobRequest = {}) {
  const event_job_request = build_event_job_request(job_request);
  if (!event_job_request) return false;

  try {
    await launch_event_job_request(event_job_request);
    return true;
  } catch (error) {
    log_event_job_request_failure(error);
    return false;
  }
}

async function start_queue_event_job_request(input: {
  workspace_id: string;
  queue_key: string;
  delay_ms: number;
}) {
  const dispatched = await start_event_job_request(input);
  if (dispatched) return;

  log.error('Queued jobs could not be dispatched to an API request', {
    api_url: env.API_URL,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
  });
}

function build_event_job_request(job_request: EventJobRequest) {
  const secret = event_job_request_secret();
  if (!secret) {
    log.error('HTTP event-job dispatch has no COWORKER_API_PROXY_SECRET to sign with');
    return null;
  }

  const api_url = new URL(env.API_URL).origin;
  return {
    request_url: new URL('/internal/run-queued-jobs', api_url).toString(),
    request: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-coworker-api-secret': secret,
      },
      body: JSON.stringify(job_request),
    } satisfies RequestInit,
  };
}

async function launch_event_job_request(
  input: NonNullable<ReturnType<typeof build_event_job_request>>,
) {
  const response = await fetch(input.request_url, input.request);
  void read_event_job_response(response).catch(log_event_job_request_failure);
}

function uses_http_event_job_dispatch() {
  return env.EVENT_JOB_DISPATCH_MODE === 'http';
}

function log_event_job_request_failure(error: unknown) {
  log.error('run-queued-jobs request failed; recovery will retry', {
    error: error_message(error),
  });
}

async function read_event_job_response(response: Response) {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Event-job endpoint returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const last_line = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!last_line?.startsWith('{')) return;

  const result = JSON.parse(last_line) as {
    error?: { code?: unknown; message?: unknown } | string;
  };
  if (result.error) {
    const message =
      typeof result.error === 'string'
        ? result.error
        : typeof result.error.message === 'string'
          ? result.error.message
          : typeof result.error.code === 'string'
            ? result.error.code
            : 'unknown error';
    throw new Error(`Event-job endpoint reported ${message}.`);
  }
}

function event_job_request_secret() {
  if (env.COWORKER_API_PROXY_SECRET) return env.COWORKER_API_PROXY_SECRET;
  if (env.NODE_ENV !== 'production' && !uses_http_event_job_dispatch()) {
    return 'local-development-internal-api-secret';
  }
  return undefined;
}

type QueueRunOptions = {
  live_events?: LiveEventPublisher | undefined;
  caller_claims_again?: boolean | undefined;
};

export function run_queue_jobs(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    worker_id?: string;
  } & QueueRunOptions,
  find_event_job_handler: FindEventJobHandler,
) {
  return run_counted_in_a_queue_run_slot(
    () => claim_and_run_queue_jobs(db, input, find_event_job_handler),
    {
      label: queue_label(input.queue_key, input.workspace_id),
      queue_key: input.queue_key,
    },
  );
}

async function claim_and_run_queue_jobs(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    worker_id?: string;
  } & QueueRunOptions,
  find_event_job_handler: FindEventJobHandler,
) {
  refuse_job_runs_outside_the_queue_worker();
  const worker_id = input.worker_id ?? new_worker_id('event_runner');
  const queue = queue_label(input.queue_key, input.workspace_id);
  const settle_delay_ms = await queue_settle_delay_ms(db, input);
  if (settle_delay_ms > 0) {
    log.info(`${queue} still settling — waiting ${format_duration(settle_delay_ms)} for the burst`);
    await schedule_next_queue_jobs_run(
      db,
      { ...input, min_delay_ms: settle_delay_ms },
      find_event_job_handler,
    );
    return { ran_jobs: false, event_jobs: [] };
  }
  const event_jobs = await claim_ready_event_jobs_for_queue(db, {
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
    worker_id,
  });
  if (event_jobs.length === 0) {
    log.debug(`nothing ready for ${queue}`);
    const active_job = await find_active_event_job_for_queue(db, input);
    if (!active_job) {
      await schedule_future_queue_jobs_run(db, input, find_event_job_handler);
    }
    return { ran_jobs: false, event_jobs: [] };
  }

  log.info(`running ${count_label(event_jobs.length, 'job')} for ${queue}`);
  await run_event_job_groups(
    db,
    {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      event_jobs,
      worker_id,
      live_events: input.live_events,
    },
    find_event_job_handler,
  );
  await schedule_next_queue_jobs_run(
    db,
    {
      ...input,
      min_delay_ms: 0,
      only_future_jobs: input.caller_claims_again === true,
    },
    find_event_job_handler,
  );
  return { ran_jobs: true, event_jobs };
}

async function schedule_future_queue_jobs_run(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  const next_job = await find_next_queued_event_job_for_queue(db, input);
  if (!next_job || next_job.available_time.getTime() <= Date.now()) return false;

  run_queue_jobs_in_the_background(
    db,
    {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      delay_ms: delay_ms_until_job_is_ready(next_job.available_time, blocked_queue_retry_ms),
    },
    find_event_job_handler,
  );
  return true;
}

const queue_settle_max_wait_ms = 5_000;

async function queue_settle_delay_ms(
  db: Database,
  input: { workspace_id: string; queue_key: string },
) {
  const [barrier_time, latest] = await Promise.all([
    find_latest_queued_barrier_time_for_queue(db, input),
    find_latest_queued_job_time_for_queue(db, input),
  ]);
  const barrier_delay_ms = barrier_time ? barrier_time.getTime() - Date.now() : 0;
  if (barrier_delay_ms > 0) return barrier_delay_ms + 100;

  if (!latest) return 0;
  const delay_ms = latest.getTime() - Date.now();
  if (delay_ms <= 0 || delay_ms > queue_settle_max_wait_ms) return 0;
  return delay_ms + 100;
}

export function run_next_ready_queue_jobs(
  db: Database,
  input: {
    workspace_id?: string;
    worker_id?: string;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  return run_counted_in_a_queue_run_slot(
    () => claim_and_run_next_ready_queue_jobs(db, input, find_event_job_handler),
    { label: input.workspace_id ? `next ready in ${input.workspace_id}` : 'next ready queue' },
  );
}

async function claim_and_run_next_ready_queue_jobs(
  db: Database,
  input: {
    workspace_id?: string;
    worker_id?: string;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  refuse_job_runs_outside_the_queue_worker();
  const worker_id = input.worker_id ?? new_worker_id('event_runner');
  const event_jobs = await claim_next_ready_event_jobs(db, {
    worker_id,
    ...(input.workspace_id === undefined ? {} : { workspace_id: input.workspace_id }),
  });
  if (event_jobs.length === 0) return { ran_jobs: false, event_jobs: [] };
  const first_job = event_jobs[0];
  if (!first_job) return { ran_jobs: false, event_jobs: [] };

  await run_event_job_groups(
    db,
    {
      workspace_id: first_job.workspace_id,
      queue_key: first_job.queue_key,
      event_jobs,
      worker_id,
    },
    find_event_job_handler,
  );
  return { ran_jobs: true, event_jobs };
}

async function schedule_next_queue_jobs_run(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    min_delay_ms: number;
    only_future_jobs?: boolean;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  const next_job = await find_next_queued_event_job_for_queue(db, input);
  if (!next_job) return false;

  const delay_ms = delay_ms_until_job_is_ready(next_job.available_time, input.min_delay_ms);
  if (delay_ms === 0 && input.only_future_jobs) return false;
  run_queue_jobs_in_the_background(
    db,
    {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      delay_ms,
    },
    find_event_job_handler,
  );
  return true;
}

type ClaimedEventJobs = {
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  worker_id: string;
  lock_token: string;
  live_events?: LiveEventPublisher | undefined;
};

type EventJobGroup = { job_handler: string; event_jobs: EventJob[] };

async function run_event_job_groups(
  db: Database,
  input: {
    workspace_id: string;
    queue_key: string;
    event_jobs: EventJob[];
    worker_id: string;
    live_events?: LiveEventPublisher | undefined;
  },
  find_event_job_handler: FindEventJobHandler,
) {
  const claim = { ...input, lock_token: read_claim_lock_token(input.event_jobs) };
  const lease = start_lease_heartbeat(db, claim);

  try {
    const groups = group_event_jobs_by_handler(input.event_jobs);
    for (const [group_index, group] of groups.entries()) {
      const result = await run_one_event_job_group(db, claim, group, lease, find_event_job_handler);
      await save_group_result(db, claim, lease, group, result);
      if (result.retry_at && event_job_group_blocks_later_jobs(group)) {
        await release_later_groups(db, claim, lease, groups.slice(group_index + 1));
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof EventJobClaimLostError)) throw error;
    log_lost_event_job_claim(error, {
      workspace_id: claim.workspace_id,
      queue_key: claim.queue_key,
      worker_id: claim.worker_id,
      lock_token: claim.lock_token,
    });
  } finally {
    lease.stop();
  }
}

function read_claim_lock_token(event_jobs: EventJob[]) {
  const lock_token = event_jobs[0]?.lock_token;
  if (!lock_token) throw new Error('A claimed event job has no lock token.');
  return lock_token;
}

async function run_one_event_job_group(
  db: Database,
  claim: ClaimedEventJobs,
  group: EventJobGroup,
  lease: EventJobLease,
  find_event_job_handler: FindEventJobHandler,
) {
  const events = await list_events_for_event_jobs(db, {
    workspace_id: claim.workspace_id,
    event_jobs: group.event_jobs,
  });
  const job_ids = group.event_jobs.map((job) => job.job_id);
  const held = { workspace_id: claim.workspace_id, lock_token: claim.lock_token, job_ids };
  const result = await run_event_job_handler(
    db,
    {
      ...claim,
      ...group,
      events,
      heartbeat: lease.heartbeat,
      signal: lease.signal,
      record_progress: async (progress) => {
        await lease.write_while_held('saving progress', job_ids, () =>
          save_event_job_progress(db, { ...held, progress }),
        );
      },
      record_started_run_id: async (run_id) => {
        await lease.write_while_held('recording the started run', job_ids, () =>
          set_event_jobs_run_id(db, { ...held, run_id }),
        );
      },
    },
    find_event_job_handler,
  );
  lease.throw_if_failed();
  log_failed_event_job_result(group.job_handler, result, { ...claim, ...group });
  return result;
}

async function save_group_result(
  db: Database,
  claim: ClaimedEventJobs,
  lease: EventJobLease,
  group: EventJobGroup,
  result: EventJobHandlerResult,
) {
  const job_ids = group.event_jobs.map((job) => job.job_id);
  await lease.write_and_let_go(`saving the ${group.job_handler} result`, job_ids, () =>
    save_event_job_result(db, {
      workspace_id: claim.workspace_id,
      lock_token: claim.lock_token,
      job_ids,
      result,
    }),
  );
}

async function release_later_groups(
  db: Database,
  claim: ClaimedEventJobs,
  lease: EventJobLease,
  later_groups: EventJobGroup[],
) {
  const job_ids = later_groups.flatMap((group) => group.event_jobs.map((job) => job.job_id));
  await lease.write_and_let_go('releasing jobs a barrier holds back', job_ids, () =>
    release_event_job_claims(db, {
      workspace_id: claim.workspace_id,
      lock_token: claim.lock_token,
      job_ids,
    }),
  );
}

type EventJobHandlerInput = {
  workspace_id: string;
  queue_key: string;
  job_handler: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  live_events?: LiveEventPublisher | undefined;
} & Omit<EventJobHandlerControls, 'run_queue_jobs_in_the_background' | 'live_events'>;

async function run_event_job_handler(
  db: Database,
  input: EventJobHandlerInput,
  find_event_job_handler: FindEventJobHandler,
): Promise<EventJobHandlerResult> {
  const active_started_run = await find_active_started_run(db, input);
  if (active_started_run) {
    return {
      job_status: 'failed',
      run_id: active_started_run.run_id,
      retry_at: new Date(Date.now() + 10_000),
      retry_counts_as_attempt: false,
      error_data: {
        code: 'event_job_started_run_still_active',
        message: `Started run ${active_started_run.run_id} is still active; waiting instead of starting a duplicate.`,
        run_status: active_started_run.run_status,
      },
    };
  }

  const handler = find_event_job_handler(input.job_handler);
  if (!handler) return missing_handler_result(input.job_handler);

  try {
    return await handler.run({
      db,
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      event_jobs: input.event_jobs,
      events: input.events,
      heartbeat: input.heartbeat,
      record_progress: input.record_progress,
      record_started_run_id: input.record_started_run_id,
      signal: input.signal,
      ...(input.live_events ? { live_events: input.live_events } : {}),
      run_queue_jobs_in_the_background: (job_run_input) =>
        run_queue_jobs_in_the_background(db, job_run_input, find_event_job_handler),
    });
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    return failed_result_from_thrown_error(input, error);
  }
}

function failed_result_from_thrown_error(
  input: EventJobHandlerInput,
  error: unknown,
): EventJobHandlerResult {
  report_thrown_handler_error(input, error);
  const oldest_created_ms = Math.min(...input.event_jobs.map((job) => job.created_time.getTime()));
  const now = new Date();
  const first_failure_time = read_first_transient_failure_time(input.event_jobs, error, now);
  const retry = Number.isFinite(oldest_created_ms)
    ? resolve_retry_for_failed_job(
        error,
        new Date(oldest_created_ms),
        now,
        first_failure_time ?? undefined,
      )
    : undefined;
  const failed = failed_handler_result(error);
  return {
    ...failed,
    ...(first_failure_time
      ? {
          error_data: {
            ...failed.error_data,
            first_failure_time: first_failure_time.toISOString(),
          },
        }
      : {}),
    ...(retry ? { retry_at: retry.retry_at } : {}),
  };
}

function report_thrown_handler_error(input: EventJobHandlerInput, error: unknown) {
  const safe_failure = read_event_job_failure(error);
  try {
    event_job_error_reporter?.(error, {
      workspace_id: input.workspace_id,
      queue_key: input.queue_key,
      job_handler: input.job_handler,
      job_ids: input.event_jobs.map((job) => job.job_id),
      run_ids: input.event_jobs.flatMap((job) => (job.run_id ? [job.run_id] : [])),
      ...(safe_failure ? { error_code: safe_failure.code, safe_tags: safe_failure.safe_tags } : {}),
    });
  } catch (reporter_error) {
    log.error('Event job error reporter threw', {
      reporter_error: error_message(reporter_error),
    });
  }
  log.error('Event job handler threw', {
    job_handler: input.job_handler,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
    job_count: input.event_jobs.length,
    error_code: safe_failure?.code ?? 'event_job_handler_failed',
    error: error_message(error),
  });
}

async function find_active_started_run(
  db: Database,
  input: { workspace_id: string; event_jobs: EventJob[] },
) {
  const run_ids = input.event_jobs.flatMap((job) => (job.run_id ? [job.run_id] : []));
  const started_runs = await list_runs_still_in_progress(db, {
    workspace_id: input.workspace_id,
    run_ids,
  });
  return started_runs.find(
    (run) => run.run_status === 'waiting' || !job_of_run_was_interrupted(input.event_jobs, run),
  );
}

function job_of_run_was_interrupted(event_jobs: EventJob[], run: { run_id: string }) {
  return event_jobs.some((job) => job.run_id === run.run_id && job.interruption_count > 0);
}

function log_failed_event_job_result(
  job_handler: string,
  result: EventJobHandlerResult,
  input: { workspace_id: string; queue_key: string; event_jobs: EventJob[] },
) {
  if (result.job_status !== 'failed') return;

  log.error('Event job handler failed', {
    job_handler,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
    job_ids: input.event_jobs.map((job) => job.job_id),
    run_id: result.run_id,
    error_data: result.error_data,
  });
}

export function group_event_jobs_by_handler(event_jobs: EventJob[]) {
  const groups = new Map<string, { job_handler: string; event_jobs: EventJob[] }>();
  for (const event_job of event_jobs) {
    const group_key = JSON.stringify([event_job.job_handler, event_job.run_id]);
    const group = groups.get(group_key) ?? {
      job_handler: event_job.job_handler,
      event_jobs: [],
    };
    group.event_jobs.push(event_job);
    groups.set(group_key, group);
  }
  return [...groups.values()].sort((left, right) =>
    compare_event_jobs(oldest_event_job(left.event_jobs), oldest_event_job(right.event_jobs)),
  );
}

function oldest_event_job(event_jobs: EventJob[]) {
  return event_jobs.reduce((oldest, job) => (compare_event_jobs(job, oldest) < 0 ? job : oldest));
}

function compare_event_jobs(left: EventJob, right: EventJob) {
  return (
    left.created_time.getTime() - right.created_time.getTime() ||
    left.job_id.localeCompare(right.job_id)
  );
}

function event_job_group_blocks_later_jobs(group: { event_jobs: EventJob[] }) {
  return group.event_jobs.some(
    (job) => job.metadata[event_job_queue_barrier_metadata_key] === true,
  );
}

function delay_ms_until_job_is_ready(available_time: Date, min_delay_ms: number) {
  return Math.max(available_time.getTime() - Date.now(), min_delay_ms);
}

function missing_handler_result(job_handler: string): EventJobHandlerResult {
  return {
    job_status: 'failed',
    error_data: {
      code: 'event_job_handler_missing',
      message: `No event job handler registered for ${job_handler}.`,
    },
  };
}

function read_first_transient_failure_time(
  jobs: EventJob[],
  error: unknown,
  now: Date,
): Date | null {
  const stored = jobs
    .map((job) => job.error_data?.first_failure_time)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (stored.length > 0) return new Date(Math.min(...stored));
  return is_transient_provider_error(error) ? now : null;
}

function failed_handler_result(error: unknown): EventJobHandlerResult {
  const safe_failure = read_event_job_failure(error);
  return {
    job_status: 'failed',
    error_data: {
      code: safe_failure?.code ?? 'event_job_handler_failed',
      message:
        safe_failure?.message ??
        (error instanceof Error ? error.message : 'Event job handler failed.'),
    },
  };
}

function error_message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function new_worker_id(source: string) {
  return `${source}:${runner_instance_id}:${randomUUID()}`;
}
