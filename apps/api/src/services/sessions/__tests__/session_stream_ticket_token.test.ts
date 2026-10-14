import {
  issue_session_stream_ticket,
  read_browser_safe_connection_token,
} from '@api/services/sessions/session_stream_ticket';
import { env } from '@coworker/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

function with_tokens(tokens: { RIVET_TOKEN?: string; RIVET_CONNECTION_TOKEN?: string }) {
  vi.spyOn(env, 'RIVET_TOKEN', 'get').mockReturnValue(tokens.RIVET_TOKEN);
  vi.spyOn(env, 'RIVET_CONNECTION_TOKEN', 'get').mockReturnValue(tokens.RIVET_CONNECTION_TOKEN);
}

describe('the connection token a browser gets', () => {
  it('is the connection token on a hosted engine', () => {
    with_tokens({ RIVET_TOKEN: 'sk_server', RIVET_CONNECTION_TOKEN: 'ck_browser' });
    expect(read_browser_safe_connection_token('https://api.rivet.dev')).toBe('ck_browser');
  });

  it.each([
    ['the server token', 'admin'],
    ['an sk_ token', 'sk_b'],
    ['a token of an unknown kind', 'pk_browser'],
    ['a token with ck_ inside it', 'x_ck_browser'],
  ])('is never %s on a hosted engine', (_kind, token) => {
    with_tokens({ RIVET_TOKEN: 'admin', RIVET_CONNECTION_TOKEN: token });
    expect(() => read_browser_safe_connection_token('https://api.rivet.dev')).toThrow(
      expect.objectContaining({ code: 'live_stream_unavailable', status: 404 }),
    );
  });

  it('may be the admin token on a local engine', () => {
    with_tokens({ RIVET_TOKEN: 'admin', RIVET_CONNECTION_TOKEN: 'admin' });
    expect(read_browser_safe_connection_token('http://127.0.0.1:27800')).toBe('admin');
  });
});

describe('a stream ticket while the engine does not answer', () => {
  it('is refused as live_stream_unavailable, so the chat keeps its per-run stream', async () => {
    vi.spyOn(env, 'EVENT_JOB_DISPATCH_MODE', 'get').mockReturnValue('rivet');
    vi.spyOn(env, 'RIVET_ENDPOINT', 'get').mockReturnValue('http://127.0.0.1:1');
    vi.spyOn(env, 'RIVET_PUBLIC_ENDPOINT', 'get').mockReturnValue('http://127.0.0.1:1');
    vi.spyOn(env, 'RIVET_NAMESPACE', 'get').mockReturnValue('default');
    with_tokens({ RIVET_TOKEN: 'admin', RIVET_CONNECTION_TOKEN: 'admin' });

    await expect(
      issue_session_stream_ticket({ workspace_id: 'ws_1', session_id: 'ses_1', user_id: 'user_1' }),
    ).rejects.toMatchObject({ code: 'live_stream_unavailable', status: 503 });
  });
});
