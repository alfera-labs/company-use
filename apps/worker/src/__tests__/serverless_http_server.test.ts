import {
  refuse_requests_without_worker_secret,
  worker_secret_header,
} from '@worker/serverless_http_server';
import { describe, expect, it, vi } from 'vitest';

const secret = 'a-worker-secret-that-is-32-chars-long';
const start_url = 'https://worker.example/api/rivet/start';

function create_gate() {
  const rivetkit = vi.fn(async () => new Response('rivetkit answered'));
  return { rivetkit, fetch: refuse_requests_without_worker_secret(secret, rivetkit) };
}

describe('the serverless worker secret check', () => {
  it('refuses a request with no secret or a wrong secret before rivetkit reads it', async () => {
    const gate = create_gate();
    const no_secret = await gate.fetch(new Request(start_url, { method: 'POST' }));
    const wrong_secret = await gate.fetch(
      new Request(start_url, { method: 'POST', headers: { [worker_secret_header]: `${secret}x` } }),
    );
    expect([no_secret.status, wrong_secret.status]).toEqual([401, 401]);
    expect(gate.rivetkit).not.toHaveBeenCalled();
  });

  it('passes a request with the right secret to rivetkit', async () => {
    const gate = create_gate();
    const response = await gate.fetch(
      new Request(start_url, { method: 'POST', headers: { [worker_secret_header]: secret } }),
    );
    expect(await response.text()).toBe('rivetkit answered');
    expect(gate.rivetkit).toHaveBeenCalledOnce();
  });
});
