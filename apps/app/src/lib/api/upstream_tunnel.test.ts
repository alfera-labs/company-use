import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetch_through_tunnel, set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';

function socket_drop_error(code: string): Error {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = { code };
  return error;
}

const ngrok_url = 'https://example-tunnel-host.ngrok-free.dev/v1/workspace';
const localhost_url = 'http://localhost:3001/v1/workspace';
const cloud_url = 'https://api.alfera.ai/v1/workspace';

const original_vercel = process.env.VERCEL;

beforeEach(() => {
  delete process.env.VERCEL;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (original_vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = original_vercel;
});

describe('set_upstream_tunnel_headers', () => {
  it('adds the ngrok skip-warning header for a local ngrok target', () => {
    const headers = set_upstream_tunnel_headers(new Headers(), ngrok_url);
    expect(headers.get('ngrok-skip-browser-warning')).toBe('true');
  });

  it('does not add the header for a cloud origin (never in cloud)', () => {
    const headers = set_upstream_tunnel_headers(new Headers(), cloud_url);
    expect(headers.get('ngrok-skip-browser-warning')).toBeNull();
  });

  it('does not add the header when running on Vercel, even for an ngrok URL', () => {
    process.env.VERCEL = '1';
    const headers = set_upstream_tunnel_headers(new Headers(), ngrok_url);
    expect(headers.get('ngrok-skip-browser-warning')).toBeNull();
  });
});

describe('fetch_through_tunnel — local tunnel target', () => {
  it('retries a bodyless request after a transient socket drop and returns the eventual response', async () => {
    const ok = new Response('ok', { status: 200 });
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(socket_drop_error('UND_ERR_SOCKET'))
      .mockResolvedValueOnce(ok);

    const response = await fetch_through_tunnel(ngrok_url, { method: 'GET' });

    expect(response.status).toBe(200);
    expect(fetch_spy).toHaveBeenCalledTimes(2);
  });

  it('retries connect timeouts too, up to three attempts, then rethrows the last error', async () => {
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(socket_drop_error('UND_ERR_CONNECT_TIMEOUT'));

    await expect(fetch_through_tunnel(localhost_url, { method: 'GET' })).rejects.toThrow(
      'fetch failed',
    );
    expect(fetch_spy).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient error', async () => {
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('some other failure'));

    await expect(fetch_through_tunnel(ngrok_url, { method: 'GET' })).rejects.toThrow(
      'some other failure',
    );
    expect(fetch_spy).toHaveBeenCalledTimes(1);
  });

  it('never replays a streaming request body: can_retry false means one attempt', async () => {
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(socket_drop_error('UND_ERR_SOCKET'));

    await expect(
      fetch_through_tunnel(ngrok_url, { method: 'POST' }, { can_retry: false }),
    ).rejects.toThrow('fetch failed');
    expect(fetch_spy).toHaveBeenCalledTimes(1);
  });
});

describe('fetch_through_tunnel — cloud target (strict no-op)', () => {
  it('does NOT retry against a cloud origin: a transient error surfaces on the first attempt', async () => {
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(socket_drop_error('UND_ERR_SOCKET'));

    await expect(fetch_through_tunnel(cloud_url, { method: 'GET' })).rejects.toThrow(
      'fetch failed',
    );
    expect(fetch_spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry when on Vercel, even for an ngrok URL', async () => {
    process.env.VERCEL = '1';
    const fetch_spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(socket_drop_error('UND_ERR_SOCKET'));

    await expect(fetch_through_tunnel(ngrok_url, { method: 'GET' })).rejects.toThrow(
      'fetch failed',
    );
    expect(fetch_spy).toHaveBeenCalledTimes(1);
  });
});
