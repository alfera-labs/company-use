import { create_app } from '@api/app';
import { wait_for_event_job_requests_to_finish } from '@api/services/events/event_job_requests';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const test_secret = 'local-development-internal-api-secret';
const original_event_job_config = {
  API_URL: env.API_URL,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  WORKER_RECOVERY_DISPATCH_CONCURRENCY: env.WORKER_RECOVERY_DISPATCH_CONCURRENCY,
};

async function post_run_queued_jobs(
  app: ReturnType<typeof create_app>,
  body: unknown,
  secret?: string,
) {
  return app.request('/internal/run-queued-jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === undefined ? {} : { 'x-coworker-api-secret': secret }),
    },
    body: JSON.stringify(body),
  });
}

function last_json_line(text: string) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return JSON.parse(lines[lines.length - 1] ?? '{}');
}

describe('POST /internal/run-queued-jobs', () => {
  afterEach(() => {
    Object.assign(env, original_event_job_config);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a caller without the shared secret', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await post_run_queued_jobs(app, {});

    expect(response.status).toBe(401);
  });

  it('rejects a caller with the wrong shared secret', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await post_run_queued_jobs(app, {}, 'wrong-event-job-secret');

    expect(response.status).toBe(401);
  });

  it('is mounted on the same API service that serves product routes', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const [health_response, event_job_response] = await Promise.all([
      app.request('/health'),
      post_run_queued_jobs(app, {}, test_secret),
    ]);

    expect(health_response.status).toBe(200);
    expect(event_job_response.status).toBe(200);
    expect(last_json_line(await event_job_response.text())).toEqual({
      ran_jobs: false,
      job_count: 0,
    });
  });

  it('rejects a signed-in user (machine-only route)', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/internal/run-queued-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-coworker-api-secret': test_secret,
        'x-coworker-auth-user-id': 'user_123',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
  });

  it('answers a request with nothing queued as no jobs ran', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await post_run_queued_jobs(app, {}, test_secret);
    const result = last_json_line(await response.text());

    expect(response.status).toBe(200);
    expect(result).toEqual({ ran_jobs: false, job_count: 0 });
  });

  it('answers a request for a subject with no jobs as no jobs ran', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await post_run_queued_jobs(
      app,
      { workspace_id: 'ws_none', queue_key: 'session:none' },
      test_secret,
    );
    const result = last_json_line(await response.text());

    expect(response.status).toBe(200);
    expect(result).toEqual({ ran_jobs: false, job_count: 0 });
  });

  it('keeps shutdown draining until a streamed event job has finished', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const response = await post_run_queued_jobs(
      app,
      { workspace_id: 'ws_none', queue_key: 'session:delayed', delay_ms: 300 },
      test_secret,
    );
    const response_body_promise = response.text();
    let drain_finished = false;
    const drain = wait_for_event_job_requests_to_finish().then(() => {
      drain_finished = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drain_finished).toBe(false);
    await drain;
    const body = await response_body_promise;

    expect(drain_finished).toBe(true);
    expect(response.status).toBe(200);
    expect(last_json_line(body)).toEqual({ ran_jobs: false, job_count: 0 });
  });

  it.each([
    ['invalid JSON', 'not json at all', 'Request body must be valid JSON'],
    [
      'an unsupported request shape',
      JSON.stringify({ run_recovery: false }),
      'Request body failed validation',
    ],
  ])('rejects %s with a validation response', async (_case, request_body, message) => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/internal/run-queued-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coworker-api-secret': test_secret },
      body: request_body,
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({ code: 'validation_error', message });
  });

  it('does not issue self-requests when recovery finds no ready jobs or deliveries', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const sent_bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, request?: RequestInit) => {
        expect(String(url)).toBe('http://api.test/internal/run-queued-jobs');
        sent_bodies.push(String(request?.body));
        return new Response('ok');
      }),
    );
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: test_secret,
      EVENT_JOB_DISPATCH_MODE: 'http',
    });

    const response = await post_run_queued_jobs(app, { run_recovery: true }, test_secret);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      recovered_jobs: 0,
      recovered_runs: 0,
      run_requests_sent: 0,
    });
    expect(sent_bodies).toHaveLength(0);
  });

  it('sends one targeted run request per distinct ready subject', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    await queue_ready_queues(db, 3, 'ready_count');
    await enqueue_event_jobs(db, event_for_queue('ready_count_duplicate', 'subject:ready_count:0'));
    await enqueue_event_jobs(db, {
      ...event_for_queue('ready_count_future', 'subject:ready_count:future'),
      event_jobs: [
        {
          job_handler: 'missing_test_handler',
          available_time: new Date(Date.now() + 60_000),
        },
      ],
    });

    const sent_bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, request?: RequestInit) => {
        expect(String(url)).toBe('http://api.test/internal/run-queued-jobs');
        sent_bodies.push(String(request?.body));
        return new Response('ok');
      }),
    );
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: test_secret,
      EVENT_JOB_DISPATCH_MODE: 'http',
      WORKER_RECOVERY_DISPATCH_CONCURRENCY: 5,
    });

    const response = await post_run_queued_jobs(app, { run_recovery: true }, test_secret);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      recovered_jobs: 0,
      recovered_runs: 0,
      run_requests_sent: 3,
    });
    expect(sent_bodies.map((body) => JSON.parse(body))).toEqual(
      expect.arrayContaining(
        Array.from({ length: 3 }, (_, subject_index) => ({
          workspace_id: 'workspace_recovery_dispatch',
          queue_key: `subject:ready_count:${subject_index}`,
        })),
      ),
    );
  });

  it('caps recovery run requests at the configured dispatch concurrency', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    await queue_ready_queues(db, 7, 'ready_cap');

    const sent_bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, request?: RequestInit) => {
        sent_bodies.push(String(request?.body));
        return new Response('ok');
      }),
    );
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: test_secret,
      EVENT_JOB_DISPATCH_MODE: 'http',
      WORKER_RECOVERY_DISPATCH_CONCURRENCY: 5,
    });

    const response = await post_run_queued_jobs(app, { run_recovery: true }, test_secret);
    const body = await response.json();
    const sent_requests = sent_bodies.map((request_body) => JSON.parse(request_body));

    expect(body.data.run_requests_sent).toBe(5);
    expect(sent_requests).toHaveLength(5);
    expect(
      sent_requests.every((request) => request.workspace_id === 'workspace_recovery_dispatch'),
    ).toBe(true);
    expect(new Set(sent_requests.map((request) => request.queue_key)).size).toBe(5);
  });
});

async function queue_ready_queues(
  db: Awaited<ReturnType<typeof create_test_database>>,
  subject_count: number,
  source_prefix: string,
) {
  await Promise.all(
    Array.from({ length: subject_count }, (_, subject_index) =>
      enqueue_event_jobs(
        db,
        event_for_queue(
          `${source_prefix}_${subject_index}`,
          `subject:${source_prefix}:${subject_index}`,
        ),
      ),
    ),
  );
}

function event_for_queue(source_event_id: string, queue_key: string) {
  return {
    workspace_id: 'workspace_recovery_dispatch',
    source: 'test',
    source_event_id,
    event_type: 'test.event',
    queue_key,
    actor_key: 'test:user',
    event_jobs: [{ job_handler: 'missing_test_handler' }],
  };
}
