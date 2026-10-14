import { AppError } from '@coworker/shared';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';
import { type GmailTransport, gmail_api_url } from '@runtime-platform/tools/gmail/gmail_api';

const gmail_draft_upload_url =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=resumable';
const upload_session_hosts = ['gmail.googleapis.com', 'www.googleapis.com'];

type ComposioProxyRequest = Parameters<ComposioClient['proxy_execute']>[0];

/**
 * Composio's proxy refuses JSON bodies above about 4 MB, so a draft with real attachments cannot
 * travel through it. Only the small resumable-upload start goes through the proxy; Google answers
 * with a one-time session URL that already carries the authorization, and the MIME bytes are
 * PUT there directly.
 */
export function create_composio_gmail_transport(input: {
  client: Pick<ComposioClient, 'proxy_execute'>;
  connected_account_id: string;
  signal?: AbortSignal | undefined;
}): GmailTransport {
  const call = async (request: Omit<ComposioProxyRequest, 'connected_account_id'>) => {
    const result = await input.client.proxy_execute(
      { connected_account_id: input.connected_account_id, ...request },
      input.signal ? { signal: input.signal } : undefined,
    );
    if (result.status >= 400) {
      throw gmail_request_error(request.method, request.endpoint, result.status, result.data);
    }
    return result;
  };

  return {
    provider: 'composio',
    get_json: async (path) =>
      (await call({ endpoint: `${gmail_api_url}${path}`, method: 'GET' })).data,
    async create_draft({ mime, thread_id }) {
      const started = await call({
        endpoint: gmail_draft_upload_url,
        method: 'POST',
        body: { message: { threadId: thread_id } },
        parameters: [
          { name: 'X-Upload-Content-Type', value: 'message/rfc822', type: 'header' },
          { name: 'X-Upload-Content-Length', value: String(mime.byteLength), type: 'header' },
        ],
      });
      const session_url = read_upload_session_url(started.headers);
      return upload_draft_bytes(session_url, mime, input.signal);
    },
    delete_draft: async (draft_id) =>
      (
        await call({
          endpoint: `${gmail_api_url}/drafts/${encodeURIComponent(draft_id)}`,
          method: 'DELETE',
        })
      ).data,
  };
}

/** The session URL comes back from a third party; bytes only ever go to Google over HTTPS. */
export function read_upload_session_url(headers: Record<string, unknown> | undefined) {
  const location = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'location',
  )?.[1];
  const url = typeof location === 'string' && URL.canParse(location) ? new URL(location) : null;
  if (!url) {
    throw new AppError(
      'gmail_upload_not_started',
      'Gmail did not return an upload session for the draft.',
      502,
    );
  }
  if (url.protocol !== 'https:' || !upload_session_hosts.includes(url.hostname)) {
    throw new AppError(
      'gmail_upload_host_refused',
      `The draft upload session points at ${url.protocol}//${url.hostname}, which is not Gmail. Nothing was uploaded.`,
      502,
    );
  }
  return url;
}

async function upload_draft_bytes(
  session_url: URL,
  mime: Buffer,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const response = await fetch(session_url, {
    method: 'PUT',
    headers: { 'content-type': 'message/rfc822' },
    body: new Uint8Array(mime),
    ...(signal ? { signal } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw gmail_request_error('PUT', 'draft upload session', response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw gmail_request_error('PUT', 'draft upload session', response.status, text);
  }
}

function gmail_request_error(method: string, target: string, status: number, data: unknown) {
  const detail = (typeof data === 'string' ? data : JSON.stringify(data ?? null)).slice(0, 300);
  return new AppError(
    'gmail_request_failed',
    `Gmail answered ${status} to ${method} ${target}: ${detail}`,
    502,
  );
}
