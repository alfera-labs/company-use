import { describe, expect, it } from 'vitest';
import { ClientDisconnected, relay_client_disconnect } from '@/lib/client_disconnect';

describe('relay_client_disconnect', () => {
  it('turns a client abort into a 499 that h3 treats as handled', () => {
    const controller = new AbortController();
    const request = new Request('http://localhost/', { signal: controller.signal });
    relay_client_disconnect(request);

    expect(request.signal.aborted).toBe(false);
    controller.abort(new Error('aborted'));

    const reason = request.signal.reason as ClientDisconnected;
    expect(request.signal.aborted).toBe(true);
    expect(reason).toBeInstanceOf(ClientDisconnected);
    expect(reason.name).toBe('HTTPError');
    expect(reason.status).toBe(499);
    expect(reason.toJSON()).toEqual({ status: 499, statusText: 'Client Closed Request' });
  });

  it('relays a request that was already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request('http://localhost/', { signal: controller.signal });
    relay_client_disconnect(request);

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBeInstanceOf(ClientDisconnected);
  });
});
