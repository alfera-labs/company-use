import { composio_error_body_schema } from '@coworker/core/integrations/composio_api_records';
import { parse_retry_after, sleep } from '@coworker/shared';
import {
  calculate_retry_delay_ms,
  composio_retry_maximum_attempts,
  may_repeat_failed_request,
} from '@runtime-platform/composio/composio_request_retry';

const default_request_timeout_ms = 60_000;

export class ComposioApiError extends Error {
  readonly status: number;
  readonly request_id?: string;
  readonly suggested_fix?: string;

  constructor(input: {
    message: string;
    status: number;
    request_id?: string | undefined;
    suggested_fix?: string | undefined;
  }) {
    super(input.message);
    this.name = 'ComposioApiError';
    this.status = input.status;
    if (input.request_id) this.request_id = input.request_id;
    if (input.suggested_fix) this.suggested_fix = input.suggested_fix;
  }
}

export type ComposioRetryNotice = {
  path: string;
  status: number | null;
  attempt: number;
  delay_ms: number;
};

export type ComposioRequestInit = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | number | boolean | undefined>;
  signal?: AbortSignal | undefined;
  repeat_when_unsure?: boolean;
};

/** Sends one Composio API request, repeating it only when the retry policy allows. */
export function send_request_with_retries(input: RequestToSend) {
  const url = build_url(input.base_url, input.path, input.init.query);
  return send_attempts_in_order(input, url, 1);
}

type RequestToSend = {
  run_fetch: typeof fetch;
  base_url: string;
  path: string;
  init: ComposioRequestInit;
  config: { api_key: string; on_retry?: ((notice: ComposioRetryNotice) => void) | undefined };
};

async function send_attempts_in_order(
  input: RequestToSend,
  url: string,
  attempt: number,
): Promise<unknown> {
  const { init, path } = input;
  const answer = await run_request_attempt(input.run_fetch, url, input.config.api_key, init);
  if (answer.outcome === 'ok') return answer.body;
  const may_repeat = may_repeat_failed_request({
    status: answer.status,
    signal: init.signal,
    repeat_when_unsure: init.repeat_when_unsure ?? true,
  });
  if (attempt >= composio_retry_maximum_attempts || !may_repeat) throw answer.error;
  const delay_ms = calculate_retry_delay_ms(attempt, answer.retry_after_ms);
  input.config.on_retry?.({ path, status: answer.status, attempt, delay_ms });
  await sleep(delay_ms);
  return send_attempts_in_order(input, url, attempt + 1);
}

type ComposioRequestAttempt =
  | { outcome: 'ok'; body: unknown }
  | {
      outcome: 'failed';
      error: Error;
      status: number | null;
      retry_after_ms: number | null;
    };

async function run_request_attempt(
  run_fetch: typeof fetch,
  url: string,
  api_key: string,
  init: ComposioRequestInit,
): Promise<ComposioRequestAttempt> {
  try {
    const response = await run_fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': api_key,
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: merge_abort_signals(init.signal),
    });
    const text = await response.text();
    if (response.ok) return { outcome: 'ok', body: parse_json_body(text) };
    return {
      outcome: 'failed',
      error: build_composio_api_error(response.status, text),
      status: response.status,
      retry_after_ms: parse_retry_after(response.headers.get('retry-after')),
    };
  } catch (error) {
    return { outcome: 'failed', error: as_error(error), status: null, retry_after_ms: null };
  }
}

/** Turns anything thrown into an Error. */
export function as_error(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function build_url(
  base_url: string,
  path: string,
  query?: Record<string, string | string[] | number | boolean | undefined>,
) {
  const url = new URL(`${base_url}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) url.searchParams.set(key, value.join(','));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Adds the request timeout to the caller's abort signal. */
export function merge_abort_signals(signal: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(default_request_timeout_ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function build_composio_api_error(status: number, text: string) {
  const parsed = composio_error_body_schema.safeParse(parse_json_body(text));
  if (!parsed.success) {
    return new ComposioApiError({
      message: text.trim() || `Composio API request failed with status ${status}.`,
      status,
    });
  }

  const error = parsed.data.error;
  return new ComposioApiError({
    message: error.message,
    status,
    ...(error.request_id ? { request_id: error.request_id } : {}),
    ...(error.suggested_fix ? { suggested_fix: error.suggested_fix } : {}),
  });
}

function parse_json_body(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
