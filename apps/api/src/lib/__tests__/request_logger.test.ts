import { redacted_request_path, request_logger } from '@api/lib/request_logger';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it, vi } from 'vitest';

describe('request logger redaction', () => {
  it('keeps route context while redacting callback verifier query values', () => {
    const path = redacted_request_path(
      'https://api.alfera.ai/v1/connections/providers/composio/webhook?connection_id=conn_123&provider_webhook_token=secret_setup_token&state=oauth_state&code=oauth_code',
    );

    expect(path).toContain('/v1/connections/providers/composio/webhook');
    expect(path).toContain('connection_id=conn_123');
    expect(path).toContain('provider_webhook_token=%5Bredacted%5D');
    expect(path).toContain('state=%5Bredacted%5D');
    expect(path).toContain('code=%5Bredacted%5D');
    expect(path).not.toContain('secret_setup_token');
    expect(path).not.toContain('oauth_state');
    expect(path).not.toContain('oauth_code');
  });

  it('keeps a signed file ticket out of the log', () => {
    expect(
      redacted_request_path('http://api.test/v1/local_file_objects?ticket=body.signature'),
    ).toBe('/v1/local_file_objects?ticket=%5Bredacted%5D');
  });

  it('logs completed requests with a request id, status, and duration', async () => {
    const log = { debug: vi.fn(), info: vi.fn() };
    const app = new Hono();
    app.use('*', requestId({ generator: () => 'request_123' }));
    app.use('*', request_logger(log));
    app.get('/health', (c) => c.text('ok'));

    const response = await app.request('https://api.alfera.ai/health?token=secret');

    expect(response.status).toBe(200);
    expect(log.debug).toHaveBeenCalledWith('request started', {
      request_id: 'request_123',
      method: 'GET',
      path: '/health?token=%5Bredacted%5D',
    });
    expect(log.info).toHaveBeenCalledWith('request completed', {
      request_id: 'request_123',
      method: 'GET',
      path: '/health?token=%5Bredacted%5D',
      status_code: 200,
      duration_ms: expect.any(Number),
      database_statement_count: 0,
    });
  });

  it('logs the final error response status after Hono handles a thrown error', async () => {
    const log = { debug: vi.fn(), info: vi.fn() };
    const app = new Hono();
    app.use('*', requestId({ generator: () => 'request_500' }));
    app.use('*', request_logger(log));
    app.get('/failure', () => {
      throw new Error('database unavailable');
    });
    app.onError(() => new Response('failed', { status: 500 }));

    const response = await app.request('https://api.alfera.ai/failure');

    expect(response.status).toBe(500);
    expect(log.info).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({ request_id: 'request_500', status_code: 500 }),
    );
  });
});
