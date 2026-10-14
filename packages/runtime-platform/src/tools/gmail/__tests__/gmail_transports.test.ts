import {
  create_composio_gmail_transport,
  read_upload_session_url,
} from '@runtime-platform/tools/gmail/composio_gmail_transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mime = Buffer.from('Subject: hello\r\n\r\nbody');
const session_url =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=resumable&upload_id=abc';

function fake_composio_client(location: string) {
  const proxy_execute = vi.fn(async (request: { endpoint: string; method: string }) =>
    request.endpoint.includes('uploadType=resumable')
      ? { status: 200, data: {}, headers: { Location: location } }
      : { status: 200, data: { emailAddress: 'venue@example.com' } },
  );
  return { proxy_execute };
}

function stub_upload_session() {
  const fetch_mock = vi.fn(
    async (_url: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'r-1', message: { id: 'm-1', threadId: 't-1' } }), {
        status: 200,
      }),
  );
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

describe('Composio Gmail transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a resumable upload through the proxy, then PUTs the raw MIME to the session', async () => {
    const client = fake_composio_client(session_url);
    const fetch_mock = stub_upload_session();
    const transport = create_composio_gmail_transport({ client, connected_account_id: 'ca_1' });

    const draft = await transport.create_draft({ mime, thread_id: 't-1' });

    expect(draft).toEqual({ id: 'r-1', message: { id: 'm-1', threadId: 't-1' } });
    expect(client.proxy_execute).toHaveBeenCalledWith(
      {
        connected_account_id: 'ca_1',
        endpoint:
          'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=resumable',
        method: 'POST',
        body: { message: { threadId: 't-1' } },
        parameters: [
          { name: 'X-Upload-Content-Type', value: 'message/rfc822', type: 'header' },
          { name: 'X-Upload-Content-Length', value: String(mime.byteLength), type: 'header' },
        ],
      },
      undefined,
    );
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    const [url, init] = fetch_mock.mock.calls[0] ?? [];
    expect(String(url)).toBe(session_url);
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'content-type': 'message/rfc822' });
    expect(init?.body).toEqual(new Uint8Array(mime));
  });

  it('never uploads to a session URL that is not Google over HTTPS', async () => {
    const fetch_mock = stub_upload_session();
    for (const location of [
      'https://evil.example.com/upload?x=1',
      'http://gmail.googleapis.com/upload',
      'https://gmail.googleapis.com.evil.example.com/upload',
    ]) {
      const transport = create_composio_gmail_transport({
        client: fake_composio_client(location),
        connected_account_id: 'ca_1',
      });
      await expect(transport.create_draft({ mime, thread_id: 't-1' })).rejects.toMatchObject({
        code: 'gmail_upload_host_refused',
      });
    }
    expect(fetch_mock).not.toHaveBeenCalled();
    expect(
      read_upload_session_url({ location: 'https://www.googleapis.com/upload/x' }).hostname,
    ).toBe('www.googleapis.com');
    expect(() => read_upload_session_url({})).toThrow(/did not return an upload session/u);
  });

  it('reports a Gmail error status from the proxy instead of treating it as data', async () => {
    const client = { proxy_execute: vi.fn(async () => ({ status: 404, data: { error: 'nope' } })) };
    const transport = create_composio_gmail_transport({ client, connected_account_id: 'ca_1' });
    await expect(transport.get_json('/messages/x')).rejects.toMatchObject({
      code: 'gmail_request_failed',
    });
  });
});

describe('no transport can send', () => {
  it('calls no send endpoint while creating a draft', async () => {
    const composio = fake_composio_client(session_url);
    const fetch_mock = stub_upload_session();
    await create_composio_gmail_transport({
      client: composio,
      connected_account_id: 'ca_1',
    }).create_draft({ mime, thread_id: 't' });

    const urls = [
      ...composio.proxy_execute.mock.calls.map(([request]) => request.endpoint),
      ...fetch_mock.mock.calls.map(([url]) => String(url)),
    ];
    expect(urls.length).toBe(2);
    for (const url of urls) expect(url).not.toMatch(/\/send\b|messages\/send|drafts\/send/u);
    vi.unstubAllGlobals();
  });
});
