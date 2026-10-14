import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { pause_rate_limit_bucket, run_under_rate_limit } from '@connectors/runtime/rate_limiter';
import { status_error_code } from '@connectors/runtime/status_error_code';
import type {
  ConnectorApp,
  ConnectorConnection,
  ConnectorErrorCode,
  ConnectorHttpMethod,
  ConnectorHttpResponse,
  ConnectorQuery,
  ConnectorResponseFormat,
} from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';
import {
  calculate_backoff_delay,
  format_error_message,
  parse_retry_after,
  sleep,
} from '@coworker/shared';

export type ConnectorHttpRequestInput = {
  app: ConnectorApp;
  connection: ConnectorConnection;
  method: ConnectorHttpMethod;
  path: string;
  query?: ConnectorQuery | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  response_format?: ConnectorResponseFormat | undefined;
  response_schema: JsonSchema;
  signal?: AbortSignal | undefined;
};

export class ConnectorHttpError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    status: number | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'ConnectorHttpError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const maximum_attempts = 4;

const retry_backoff = { base_ms: 500 };

export function build_connector_url(base_url: string, path: string, query?: ConnectorQuery) {
  const url = new URL(`${base_url.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        url.searchParams.append(name, String(entry));
      }
      continue;
    }
    url.searchParams.set(name, String(value));
  }
  return url.toString();
}

const readable_response_headers = ['link', 'retry-after', 'etag'] as const;

function pick_readable_headers(response: Response) {
  const headers: Record<string, string> = {};
  for (const name of readable_response_headers) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

async function read_error_body(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

async function read_response_body(response: Response, format: ConnectorResponseFormat) {
  const body_text = await response.text();
  if (response.status === 204 || body_text.trim() === '') return null;
  if (format === 'text') return body_text;
  try {
    return JSON.parse(body_text);
  } catch (error) {
    throw new ConnectorHttpError(
      'invalid_provider_response',
      `Provider answered with a body that is not JSON: ${format_error_message(error)}`,
      response.status,
      false,
    );
  }
}

async function parse_response<TParsed>(
  response: Response,
  schema: JsonSchema,
  format: ConnectorResponseFormat,
): Promise<TParsed> {
  const payload = await read_response_body(response, format);
  const violation = find_json_schema_violation(schema, payload, 'response');
  if (violation) {
    throw new ConnectorHttpError(
      'invalid_provider_response',
      `Provider response failed validation: ${violation}`,
      response.status,
      false,
    );
  }
  return payload as TParsed;
}

async function send_one_attempt<TParsed>(
  input: ConnectorHttpRequestInput,
  attempt: number,
): Promise<ConnectorHttpResponse<TParsed>> {
  const url = build_connector_url(input.app.base_url, input.path, input.query);
  const has_body = input.body !== undefined;
  const format = input.response_format ?? 'json';
  const response = await fetch(url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.connection.access_token}`,
      Accept: format === 'text' ? '*/*' : 'application/json',
      ...(has_body ? { 'Content-Type': 'application/json' } : {}),
      ...input.headers,
    },
    ...(has_body ? { body: JSON.stringify(input.body) } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (response.ok) {
    return {
      body: await parse_response<TParsed>(response, input.response_schema, format),
      headers: pick_readable_headers(response),
      status: response.status,
    };
  }

  const retry_after = response.headers.get('Retry-After');
  const detail = await read_error_body(response);
  const code = status_error_code(response, detail);
  if (code === 'rate_limited') {
    pause_rate_limit_bucket(
      { app_key: input.app.app_key, connection_id: input.connection.connection_id },
      input.app.rate_limits,
      parse_retry_after(retry_after) ?? calculate_backoff_delay(attempt, retry_backoff),
    );
    throw new ConnectorHttpError(
      'rate_limited',
      `${input.app.app_key} rate limit: ${detail}`,
      response.status,
      true,
    );
  }
  if (code === 'unauthorized') {
    throw new ConnectorHttpError(
      'unauthorized',
      `${input.app.app_key} refused the connection: ${detail}`,
      response.status,
      false,
    );
  }
  throw new ConnectorHttpError(
    'provider_error',
    `${input.app.app_key} request failed with ${response.status}: ${detail}`,
    response.status,
    response.status >= 500,
  );
}

export async function send_connector_http_response<TParsed = unknown>(
  input: ConnectorHttpRequestInput,
): Promise<ConnectorHttpResponse<TParsed>> {
  const rate_limit_key = {
    app_key: input.app.app_key,
    connection_id: input.connection.connection_id,
  };
  let last_error: ConnectorHttpError | null = null;

  for (let attempt = 1; attempt <= maximum_attempts; attempt += 1) {
    try {
      return await run_under_rate_limit(rate_limit_key, input.app.rate_limits, () =>
        send_one_attempt<TParsed>(input, attempt),
      );
    } catch (error) {
      const http_error = as_connector_http_error(error, input.signal);
      if (!http_error.retryable || attempt === maximum_attempts) throw http_error;
      last_error = http_error;
      if (http_error.code !== 'rate_limited') {
        await sleep(calculate_backoff_delay(attempt, retry_backoff), input.signal);
      }
    }
  }

  throw last_error ?? new ConnectorHttpError('network_error', 'Request failed.', null, true);
}

export async function send_connector_http_request<TParsed = unknown>(
  input: ConnectorHttpRequestInput,
): Promise<TParsed> {
  const response = await send_connector_http_response<TParsed>(input);
  return response.body;
}

function as_connector_http_error(error: unknown, signal: AbortSignal | undefined) {
  if (error instanceof ConnectorHttpError) return error;
  const message = format_error_message(error);
  if (signal?.aborted) {
    return new ConnectorHttpError('cancelled', `Request cancelled: ${message}`, null, false);
  }
  return new ConnectorHttpError('network_error', `Request failed: ${message}`, null, true);
}
