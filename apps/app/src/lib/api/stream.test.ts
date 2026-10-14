import { afterEach, describe, expect, it, vi } from 'vitest';
import { stream_session_message } from '@/lib/api/stream';

describe('stream_session_message', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats an abort before stream headers as an expected stop', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      }),
    );

    await expect(
      stream_session_message('ses_1', { message: 'stop quickly' }, vi.fn(), {
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-abort stream setup failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    await expect(stream_session_message('ses_1', { message: 'hello' }, vi.fn())).rejects.toThrow(
      'network down',
    );
  });

  it('sends the model provider and model proxy without rewriting them', async () => {
    const fetch_mock = vi.fn().mockResolvedValue(new Response(''));
    vi.stubGlobal('fetch', fetch_mock);

    await stream_session_message(
      'ses_1',
      {
        message: 'Use the proxy',
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      },
      vi.fn(),
    );

    const request = fetch_mock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      message: 'Use the proxy',
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
  });
});
