import { ComposioApiError } from '@runtime-platform/composio/composio_client';
import {
  type ComposioCallKind,
  map_composio_error,
} from '@runtime-platform/composio/composio_errors';
import { describe, expect, it } from 'vitest';

const metadata = { node_key: 'attio.create_note', runtime_handler: 'composio.ATTIO_CREATE_NOTE' };

function map_api_error(input: {
  status: number;
  call_kind?: ComposioCallKind;
  message?: string;
  request_id?: string;
  suggested_fix?: string;
}) {
  const error = new ComposioApiError({
    message: input.message ?? 'Composio refused the call.',
    status: input.status,
    ...(input.request_id ? { request_id: input.request_id } : {}),
    ...(input.suggested_fix ? { suggested_fix: input.suggested_fix } : {}),
  });
  return map_composio_error(error, {
    call_kind: input.call_kind ?? 'action',
    metadata,
    repeats_are_safe: true,
  });
}

describe('map_composio_error', () => {
  it.each([
    { status: 401, call_kind: 'action' as const, code: 'credential_expired', retryable: false },
    { status: 403, call_kind: 'action' as const, code: 'credential_expired', retryable: false },
    { status: 404, call_kind: 'action' as const, code: 'invalid_tool', retryable: false },
    { status: 404, call_kind: 'proxy' as const, code: 'upstream_not_found', retryable: false },
    { status: 422, call_kind: 'action' as const, code: 'composio_error', retryable: false },
    { status: 429, call_kind: 'action' as const, code: 'rate_limited', retryable: true },
    { status: 500, call_kind: 'action' as const, code: 'provider_unreachable', retryable: true },
    { status: 503, call_kind: 'proxy' as const, code: 'provider_unreachable', retryable: true },
  ])('turns a $status on a $call_kind call into $code', (expected) => {
    const failure = map_api_error({ status: expected.status, call_kind: expected.call_kind });

    expect(failure.success).toBe(false);
    expect(failure.error.code).toBe(expected.code);
    expect(failure.metadata).toMatchObject({
      ...metadata,
      composio_status: expected.status,
      retryable: expected.retryable,
    });
  });

  it('turns a 403 that names a rate limit into rate_limited, not an expired credential', () => {
    const failure = map_api_error({ status: 403, message: 'API rate limit exceeded for user.' });

    expect(failure.error.code).toBe('rate_limited');
    expect(failure.metadata).toMatchObject({ composio_status: 403, retryable: true });
  });

  it('names the upstream app as the owner of a proxy 404', () => {
    const failure = map_api_error({ status: 404, call_kind: 'proxy' });

    expect(failure.metadata).toMatchObject({ upstream_status: 404 });
  });

  it('passes the provider request id and suggested fix through to the agent', () => {
    const failure = map_api_error({
      status: 403,
      message: 'Access denied for this connected account.',
      request_id: 'req_7c19ab',
      suggested_fix: 'Reconnect the account with the notes scope.',
    });

    expect(failure.error.message).toBe(
      'Access denied for this connected account. Reconnect the account with the notes scope.',
    );
    expect(failure.metadata).toMatchObject({ request_id: 'req_7c19ab' });
  });

  it('omits the request id when the provider did not send one', () => {
    const failure = map_api_error({ status: 429 });

    expect(failure.metadata).not.toHaveProperty('request_id');
    expect(failure.error.message).toBe('Composio rate limit: Composio refused the call.');
  });

  it('treats anything that is not a Composio API failure as the provider being unreachable', () => {
    const failure = map_composio_error(new TypeError('fetch failed'), {
      call_kind: 'action',
      metadata,
      repeats_are_safe: true,
    });

    expect(failure.error).toEqual({ code: 'provider_unreachable', message: 'fetch failed' });
    expect(failure.metadata).toMatchObject({ ...metadata, retryable: true });
    expect(failure.metadata).not.toHaveProperty('composio_status');
  });

  it('reports a thrown non-error value rather than swallowing it', () => {
    const failure = map_composio_error('socket hang up', {
      call_kind: 'proxy',
      metadata,
      repeats_are_safe: true,
    });

    expect(failure.error).toEqual({ code: 'provider_unreachable', message: 'socket hang up' });
    expect(failure.metadata).toMatchObject({ retryable: true });
  });
});

describe('map_composio_error on a write that may have happened', () => {
  const write = { ...metadata, provider_component_id: 'ATTIO_CREATE_NOTE' };

  it.each([
    ['a 502', new ComposioApiError({ message: 'bad gateway', status: 502 })],
    ['no answer', new TypeError('fetch failed')],
  ])('says after %s that the action may already have taken effect', (_label, error) => {
    const failure = map_composio_error(error, {
      call_kind: 'action',
      metadata: write,
      repeats_are_safe: false,
    });

    expect(failure.error.code).toBe('action_outcome_unknown');
    expect(failure.error.message).toContain('The ATTIO_CREATE_NOTE action');
    expect(failure.error.message).toContain('may already have taken effect');
    expect(failure.error.message).toContain('Do not repeat it');
    expect(failure.metadata).toMatchObject({ retryable: false });
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'credential_expired'],
  ])('keeps a %i meaning what it meant, since nothing ran', (status, code) => {
    const failure = map_composio_error(new ComposioApiError({ message: 'refused', status }), {
      call_kind: 'action',
      metadata: write,
      repeats_are_safe: false,
    });

    expect(failure.error.code).toBe(code);
  });

  it('names the proxy request for a proxy write', () => {
    const failure = map_composio_error(new ComposioApiError({ message: 'down', status: 503 }), {
      call_kind: 'proxy',
      metadata: { ...metadata, proxy_method: 'PATCH', proxy_endpoint: '/v2/notes/n1' },
      repeats_are_safe: false,
    });

    expect(failure.error.code).toBe('action_outcome_unknown');
    expect(failure.error.message).toContain('PATCH /v2/notes/n1 returned 503');
  });
});
