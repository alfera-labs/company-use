import { notFound, redirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { ClientDisconnected } from '@/lib/client_disconnect';
import {
  drop_control_flow_throws_and_scrub_secrets,
  is_control_flow_throw,
} from '@/lib/sentry_control_flow';

describe('is_control_flow_throw', () => {
  it('recognizes the three throws TanStack uses for control flow', () => {
    expect(is_control_flow_throw(redirect({ to: '/sign-in' }))).toBe(true);
    expect(is_control_flow_throw(notFound())).toBe(true);
    expect(is_control_flow_throw(new ClientDisconnected())).toBe(true);
  });

  it('keeps real errors', () => {
    expect(is_control_flow_throw(new Error('boom'))).toBe(false);
    expect(is_control_flow_throw(new TypeError('bad'))).toBe(false);
    expect(is_control_flow_throw(undefined)).toBe(false);
  });

  it('keeps a bare Response throw', () => {
    expect(is_control_flow_throw(new Response(null, { status: 302 }))).toBe(false);
  });
});

describe('drop_control_flow_throws_and_scrub_secrets', () => {
  it('drops a client disconnect', () => {
    const dropped = drop_control_flow_throws_and_scrub_secrets(event_with_request(), {
      originalException: new ClientDisconnected(),
    });

    expect(dropped).toBeNull();
  });

  it('drops a redirect', () => {
    const dropped = drop_control_flow_throws_and_scrub_secrets(event_with_request(), {
      originalException: redirect({ to: '/sign-in' }),
    });

    expect(dropped).toBeNull();
  });

  it('keeps and scrubs a bare Response throw', () => {
    const event = event_with_request();

    const kept = drop_control_flow_throws_and_scrub_secrets(event, {
      originalException: new Response(null, { status: 302 }),
    });

    expect(kept).toBe(event);
    expect(kept?.request?.headers).toEqual({
      'user-agent': 'Chrome 149.0.0.0',
      'content-type': 'application/json',
    });
  });

  it('keeps a real error and removes the secret headers, matched without case', () => {
    const event = event_with_request();

    const kept = drop_control_flow_throws_and_scrub_secrets(event, {
      originalException: new Error('boom'),
    });

    expect(kept).toBe(event);
    expect(kept?.request?.headers).toEqual({
      'user-agent': 'Chrome 149.0.0.0',
      'content-type': 'application/json',
    });
  });

  it('keeps the path but never the query string, the parsed query, or the cookies', () => {
    const event = {
      request: {
        url: 'https://app.alfera.ai/auth/callback?code=secret_code&state=abc',
        query_string: 'code=secret_code&state=abc',
        cookies: { 'wos-session': 'sealed-session' },
        headers: {},
      },
    };

    const kept = drop_control_flow_throws_and_scrub_secrets(event, {
      originalException: new Error('boom'),
    });

    expect(kept?.request?.url).toBe('https://app.alfera.ai/auth/callback');
    expect(kept?.request).not.toHaveProperty('query_string');
    expect(kept?.request).not.toHaveProperty('cookies');
  });
});

function event_with_request() {
  return {
    request: {
      url: 'https://app.alfera.ai/home',
      headers: {
        Authorization: 'Bearer token',
        Cookie: 'wos-session=sealed-session',
        'X-Coworker-Api-Secret': 'proxy-secret',
        'user-agent': 'Chrome 149.0.0.0',
        'content-type': 'application/json',
      } as Record<string, unknown>,
    },
  };
}
