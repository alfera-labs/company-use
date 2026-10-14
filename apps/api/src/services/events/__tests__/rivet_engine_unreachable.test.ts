import { create_rivet_doorbell } from '@api/services/events/rivet_doorbell';
import { get_queue_worker_client } from '@api/services/events/rivet_queue_worker_client';
import { env } from '@coworker/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

const unreachable_engine = 'http://127.0.0.1:1';

afterEach(() => vi.restoreAllMocks());

describe('the API calls to a queue worker while the engine does not answer', () => {
  it('gives up on a stop within its time limit, so the cancel falls back to the run poll', async () => {
    vi.spyOn(env, 'EVENT_JOB_DISPATCH_MODE', 'get').mockReturnValue('rivet');
    vi.spyOn(env, 'RIVET_ENDPOINT', 'get').mockReturnValue(unreachable_engine);
    vi.spyOn(env, 'RIVET_NAMESPACE', 'get').mockReturnValue('default');
    vi.spyOn(env, 'RIVET_TOKEN', 'get').mockReturnValue('admin');
    const client = get_queue_worker_client();
    if (!client) throw new Error('rivet dispatch must give a queue worker client');

    const started = Date.now();
    await expect(
      client.cancel_run({ workspace_id: 'ws_1', queue_key: 'session:ses_1' }, 'run_1'),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 10_000);

  it('rejects a ring within its time limit, so the job stays queued for the clock to ring again', async () => {
    const doorbell = create_rivet_doorbell({
      endpoint: unreachable_engine,
      namespace: 'default',
      token: 'admin',
      pool: 'default',
    });

    const started = Date.now();
    await expect(
      doorbell.ring({ workspace_id: 'ws_1', queue_key: 'session:ses_1', job_ids: ['ejob_1'] }),
    ).rejects.toThrow('did not answer within 15000 ms');
    expect(Date.now() - started).toBeLessThan(17_000);
  }, 25_000);
});
