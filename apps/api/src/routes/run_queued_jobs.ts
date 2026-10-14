import type { ApiEnv } from '@api/lib/context';
import { verify_machine_caller } from '@api/lib/proxy_identity';
import { ok } from '@api/lib/response';
import { parse_json_text } from '@api/lib/validate';
import {
  begin_event_job_request,
  type QueueEventJobRequest,
  recover_event_jobs_and_start_requests,
  run_requested_event_jobs,
  run_tracked_event_job_request,
} from '@api/services/events/event_job_requests';
import { max_event_job_request_delay_ms, uses_rivet_event_job_dispatch } from '@coworker/jobs';
import { AppError, create_logger, format_error_message, sleep } from '@coworker/shared';
import { run_minute_maintenance } from '@runtime-platform/events/minute_maintenance';
import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { z } from 'zod';

const log = create_logger('run_queued_jobs');

// "Run queued jobs now." The job runs INSIDE this request, so concurrent work shows up to Cloud
// Run as concurrent requests — that is what makes the service scale out with job demand. The API
// calls itself on every enqueue, a finished request sends one more so a
// backlog keeps shrinking, and Cloud Scheduler calls it every minute with {"run_recovery": true}
// as the safety net for retries, delayed jobs, and requests that got lost.
export const run_queued_jobs_routes = new Hono<ApiEnv>().post(
  '/internal/run-queued-jobs',
  async (c) => {
    verify_machine_caller(c);
    if (uses_rivet_event_job_dispatch()) {
      throw new AppError(
        'event_jobs_run_on_rivet',
        'EVENT_JOB_DISPATCH_MODE=rivet: this API runs no job. Queue workers on Rivet run them.',
        409,
      );
    }
    const job_request = await read_run_queued_jobs_request(c.req.raw);
    const db = c.get('db');

    if ('run_recovery' in job_request) {
      await run_minute_maintenance(db);
      return c.json(
        ok(await run_tracked_event_job_request(() => recover_event_jobs_and_start_requests(db))),
      );
    }

    // The response is streamed: headers go out now and a heartbeat line follows every 30s, so the
    // caller's fetch never times out waiting for a run that takes many minutes, and the hosting
    // platform counts the request as active until the run finishes.
    const finish_event_job = begin_event_job_request();
    try {
      return await streamText(c, async (stream) => {
        let stop_heartbeat: () => void = () => undefined;
        try {
          await stream.writeln('');
          stop_heartbeat = start_response_heartbeat(stream);
          try {
            if ('workspace_id' in job_request) await wait_for_enqueue_delay(job_request.delay_ms);
            const result = await run_requested_event_jobs(db, job_request);
            await stream.writeln(JSON.stringify(result));
          } catch (error) {
            log.error('running queued jobs failed', {
              error: format_error_message(error),
            });
            await stream.writeln(
              JSON.stringify({
                ran_jobs: false,
                error: {
                  code: 'run_failed',
                  message: 'Running queued event jobs failed',
                },
              }),
            );
          }
        } finally {
          stop_heartbeat();
          finish_event_job();
        }
      });
    } catch (error) {
      finish_event_job();
      throw error;
    }
  },
);

const heartbeat_interval_ms = 30_000;

function start_response_heartbeat(stream: { writeln: (text: string) => Promise<unknown> }) {
  const timer = setInterval(() => {
    stream.writeln('').catch((error: unknown) => {
      log.debug('Heartbeat write failed; the caller hung up and the job keeps running', {
        error: format_error_message(error),
      });
    });
  }, heartbeat_interval_ms);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

// An enqueue can ask for a short delay (message-burst debounce). Waiting here, inside the
// request, keeps the instance's CPU on during the wait — a timer after responding would be
// throttled. Capped so a bad caller cannot pin a request slot for long.
function wait_for_enqueue_delay(delay_ms: number | undefined) {
  const wait_ms = Math.min(Math.max(delay_ms ?? 0, 0), max_event_job_request_delay_ms);
  if (wait_ms === 0) return Promise.resolve();
  return sleep(wait_ms);
}

const queue_request_fields = {
  workspace_id: z.string().min(1),
  delay_ms: z.number().int().nonnegative().optional(),
};

const run_queued_jobs_request_schema = z.union([
  z.object({ run_recovery: z.literal(true) }).strict(),
  z.object({ ...queue_request_fields, queue_key: z.string().min(1) }).strict(),
  z
    .object({ ...queue_request_fields, subject_key: z.string().min(1) })
    .strict()
    .transform(({ subject_key, ...request }) => ({ ...request, queue_key: subject_key })),
  z.object({}).strict(),
]);

async function read_run_queued_jobs_request(request: Request) {
  const text = await request.text();
  if (!text) return {};
  return parse_json_text(text, run_queued_jobs_request_schema) as
    | { run_recovery: true }
    | QueueEventJobRequest
    | Record<string, never>;
}
