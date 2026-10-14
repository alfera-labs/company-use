import type { ApiApp } from '@coworker/api';
import { read_api_origin } from '@coworker/config/api_origin';
import { hc } from 'hono/client';

let sign_in_redirect_started = false;

const fetch_with_credentials: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, credentials: 'include' });
  redirect_to_sign_in_when_unauthorized(response);
  return response;
};

export function build_sign_in_url_for_current_page(
  current_location: Pick<Location, 'hash' | 'origin' | 'pathname' | 'search'>,
) {
  const return_to = `${current_location.pathname}${current_location.search}${current_location.hash}`;
  const sign_in_url = new URL('/auth/sign-in', current_location.origin);
  sign_in_url.searchParams.set('returnTo', return_to || '/');
  return sign_in_url;
}

function redirect_to_sign_in_when_unauthorized(response: Response) {
  if (response.status !== 401) return;
  if (typeof window === 'undefined') return;
  if (sign_in_redirect_started) return;

  sign_in_redirect_started = true;
  window.location.assign(build_sign_in_url_for_current_page(window.location).toString());
}

function resolve_api_base_url() {
  if (typeof window !== 'undefined') return `${window.location.origin}/api`;
  return read_api_origin();
}

export const api_client = hc<ApiApp>(resolve_api_base_url(), { fetch: fetch_with_credentials });

export const api_base_url = resolve_api_base_url();
export const api_fetch = fetch_with_credentials;

export function api_url(path: string) {
  // Relative to the base, so the base's own prefix (`/api` in the browser) survives; a leading
  // slash would resolve against the origin and drop it.
  return new URL(path.replace(/^\//u, ''), `${resolve_api_base_url()}/`);
}

export const session_by_id_client = api_client.v1.sessions[':session_id'];
export const session_sandbox_previews_client = session_by_id_client['sandbox-previews'];
export const session_tool_calls_client = session_by_id_client['tool-calls'];
export const session_queued_messages_client = session_by_id_client['queued-messages'];
export const session_stream_ticket_client = session_by_id_client['stream-ticket'];
export const run_by_id_client = api_client.v1.runs[':run_id'];
export const run_inspection_client = run_by_id_client.inspect;
export const run_chat_stream_events_client = run_by_id_client['chat-stream-events'];
export const run_tool_calls_client = run_by_id_client['tool-calls'];
export const artifact_content_client = api_client.v1.files[':file_id'].content;
export const connection_by_id_client = api_client.v1.connections[':connection_id'];
export const agent_by_id_client = api_client.v1.agents[':agent_id'];
export const agent_enabled_nodes_client = agent_by_id_client['enabled-nodes'];
export const workspace_files_client = api_client.v1.workspace.files;
export const workspace_file_content_client = workspace_files_client.content;

export const no_store_request = { init: {} } satisfies Parameters<
  typeof api_client.v1.sessions.$get
>[1];

type ReadableApiResponse<T> = Response & { json(): Promise<{ data: T } | unknown> };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function read_api_data<T>(
  response: ReadableApiResponse<T>,
  request: { method: string; path: string },
): Promise<T> {
  if (!response.ok) {
    const { message, code } = await read_api_error(response, request);
    throw new ApiError(message, response.status, code);
  }

  const body = (await response.json()) as { data: T };
  return body.data;
}

async function read_api_error(response: Response, request: { method: string; path: string }) {
  const fallback = `${request.method} ${request.path} failed (${response.status})`;
  try {
    const body = (await response.clone().json()) as unknown;
    const error = read_response_error(body);
    return { message: error?.message ?? fallback, code: error?.code ?? null };
  } catch {
    return { message: fallback, code: null };
  }
}

function read_response_error(
  body: unknown,
): { message: string | null; code: string | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const message = (error as Record<string, unknown>).message;
  const code = (error as Record<string, unknown>).code;
  return {
    message: typeof message === 'string' && message.trim() ? message : null,
    code: typeof code === 'string' && code.trim() ? code : null,
  };
}
