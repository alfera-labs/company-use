import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import {
  claim_ready_event_jobs_for_queue,
  max_event_job_request_delay_ms,
  queue_and_run_event_jobs,
  run_queue_jobs,
  run_queue_jobs_in_the_background,
} from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspace_id = 'ws_settle';
const queue_key = 'slack:T1:C1:thread:1';
const original_event_job_config = {
  API_URL: env.API_URL,
  COWORKER_API_PROXY_SECRET: env.COWORKER_API_PROXY_SECRET,
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
};

describe('subject jobs settle window', () => {
  afterEach(() => {
    Object.assign(env, original_event_job_config);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defers claiming while the newest job is still inside its debounce window', async () => {
    const db = await create_test_database();
    await enqueue_message(db, 'evt_settle_1', -100);
    await enqueue_message(db, 'evt_settle_2', 800);

    const early = await run_queue_jobs(db, { workspace_id, queue_key }, find_event_job_handler);
    expect(early.ran_jobs).toBe(false);
    expect(early.event_jobs).toHaveLength(0);
  });

  it('claims a settled burst as one batch', async () => {
    const db = await create_test_database();
    await enqueue_message(db, 'evt_settle_a', -200);
    await enqueue_message(db, 'evt_settle_b', -100);

    const result = await run_queue_jobs(db, { workspace_id, queue_key }, find_event_job_handler);
    expect(result.ran_jobs).toBe(true);
    expect(result.event_jobs).toHaveLength(2);
  });

  it('does not start an HTTP polling chain when another request owns the subject', async () => {
    const db = await create_test_database();
    await enqueue_message(db, 'evt_active_owner', -200);
    await claim_ready_event_jobs_for_queue(db, {
      workspace_id,
      queue_key,
      worker_id: 'worker_active_owner',
    });
    await enqueue_message(db, 'evt_waiting_for_owner', -100);
    const fetch_spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetch_spy);
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });

    const result = await run_queue_jobs(db, { workspace_id, queue_key }, find_event_job_handler);

    expect(result.ran_jobs).toBe(false);
    expect(fetch_spy).not.toHaveBeenCalled();
  });

  it('leaves long database delays to scheduled recovery instead of pinning API requests', async () => {
    const db = await create_test_database();
    const fetch_spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetch_spy);
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });

    run_queue_jobs_in_the_background(
      db,
      {
        workspace_id,
        queue_key,
        delay_ms: max_event_job_request_delay_ms + 1,
      },
      find_event_job_handler,
    );

    expect(fetch_spy).not.toHaveBeenCalled();
  });

  it('starts a same-service API request before a durable enqueue returns to its caller', async () => {
    const db = await create_test_database();
    let accept_request: (response: Response) => void = () => undefined;
    const request_accepted = new Promise<Response>((resolve) => {
      accept_request = resolve;
    });
    const fetch_spy = vi.fn((_url: unknown, _request?: RequestInit) => request_accepted);
    vi.stubGlobal('fetch', fetch_spy);
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });

    let enqueue_returned = false;
    const result_promise = queue_and_run_event_jobs(
      db,
      {
        workspace_id,
        source: 'slack',
        source_event_id: 'evt_awaited_worker_dispatch',
        event_type: 'message',
        queue_key,
        actor_key: 'slack_user:U1',
        event_body: { text: 'hello' },
        event_jobs: [{ job_handler: 'slack_agent_message' }],
      },
      find_event_job_handler,
    ).then((result) => {
      enqueue_returned = true;
      return result;
    });

    await vi.waitFor(() => expect(fetch_spy).toHaveBeenCalledOnce());
    expect(enqueue_returned).toBe(false);
    accept_request(new Response('ok'));
    const result = await result_promise;

    expect(result.event_jobs).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledWith(
      'http://api.test/internal/run-queued-jobs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspace_id, queue_key, delay_ms: 0 }),
      }),
    );
    const dispatch_headers = new Headers(fetch_spy.mock.calls[0]?.[1]?.headers);
    expect(dispatch_headers.get('x-coworker-api-secret')).toBe('configured-proxy-secret');
    expect(dispatch_headers.get('authorization')).toBeNull();
  });

  it('keeps a durable enqueue when the same-service request cannot connect', async () => {
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await create_test_database();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connection refused'))),
    );
    Object.assign(env, {
      API_URL: 'http://api.test',
      COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
      EVENT_JOB_DISPATCH_MODE: 'http',
    });

    const result = await queue_and_run_event_jobs(
      db,
      {
        workspace_id,
        source: 'slack',
        source_event_id: 'evt_failed_worker_dispatch',
        event_type: 'message',
        queue_key,
        actor_key: 'slack_user:U1',
        event_body: { text: 'hello' },
        event_jobs: [{ job_handler: 'slack_agent_message' }],
      },
      find_event_job_handler,
    );

    expect(result.event_jobs).toHaveLength(1);
    expect(console_error).toHaveBeenCalledWith(
      '[event_job_runner] run-queued-jobs request failed; recovery will retry {"error":"connection refused"}',
    );
  });

  it('does not self-request when dispatch mode is in-process', async () => {
    vi.useFakeTimers();
    const db = await create_test_database();
    const fetch_spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetch_spy);
    Object.assign(env, {
      EVENT_JOB_DISPATCH_MODE: 'in_process',
    });

    run_queue_jobs_in_the_background(
      db,
      { workspace_id, queue_key, delay_ms: 60_000 },
      find_event_job_handler,
    );

    expect(fetch_spy).not.toHaveBeenCalled();
  });
});

async function enqueue_message(
  db: Awaited<ReturnType<typeof create_test_database>>,
  source_event_id: string,
  available_in_ms: number,
) {
  await enqueue_event_jobs(db, {
    workspace_id,
    source: 'slack',
    source_event_id,
    event_type: 'message',
    queue_key,
    actor_key: 'slack_user:U1',
    event_body: { text: 'hello' },
    event_jobs: [
      {
        job_handler: 'slack_agent_message',
        available_time: new Date(Date.now() + available_in_ms),
      },
    ],
  });
}
