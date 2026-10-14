import { request_carries_api_key } from '@api/lib/api_key_request';
import type { ApiEnv, ApiKeyEnv } from '@api/lib/context';
import { looks_like_jwt } from '@api/lib/mcp_oauth';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyScope,
  count_api_key_request_in_window,
  find_live_api_key_by_secret,
} from '@coworker/core/db/queries/api_keys';
import { AppError } from '@coworker/shared';
import type { Context, MiddlewareHandler } from 'hono';

export const api_key_rate_window_ms = 60_000;
export const api_key_requests_per_window = 120;

export function authenticate_api_key(required_scope: ApiKeyScope): MiddlewareHandler<ApiKeyEnv> {
  return async (c, next) => {
    await attach_authenticated_api_key(c, required_scope);
    await next();
  };
}

export function key_authed_route(
  required_scope: ApiKeyScope,
  handler: (c: Context<ApiEnv>, api_key: ApiKey) => Promise<Response>,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (!request_carries_api_key(c)) return next();
    return handler(c, await attach_authenticated_api_key(c, required_scope));
  };
}

type ApiKeyRequestContext = Pick<Context, 'req' | 'header'> & {
  get(key: 'db'): Database;
  set(key: 'workspace_id', value: string): void;
  set(key: 'api_key', value: ApiKey): void;
  set(key: 'api_key_rate_remaining', value: number): void;
};

async function attach_authenticated_api_key(
  c: ApiKeyRequestContext,
  required_scope: ApiKeyScope,
): Promise<ApiKey> {
  const api_key = await find_live_api_key_by_secret(c.get('db'), read_presented_secret(c.req.raw));

  assert_api_key_scope(api_key, required_scope);
  await charge_api_key_request(c, api_key);

  c.set('workspace_id', api_key.workspace_id);
  c.set('api_key', api_key);
  return api_key;
}

export async function authenticate_api_key_request(c: ApiKeyRequestContext): Promise<ApiKey> {
  const api_key = await find_live_api_key_by_secret(c.get('db'), read_presented_secret(c.req.raw));
  await charge_api_key_request(c, api_key);
  return api_key;
}

/** A workspace API key, or the access token of a signed-in MCP client resolved to its key. */
export async function authenticate_mcp_caller(
  c: ApiKeyRequestContext,
  resolve_token: (db: Database, token: string) => Promise<ApiKey>,
): Promise<ApiKey> {
  const presented = read_presented_secret(c.req.raw);
  const api_key = looks_like_jwt(presented)
    ? await resolve_token(c.get('db'), presented)
    : await find_live_api_key_by_secret(c.get('db'), presented);
  await charge_api_key_request(c, api_key);
  return api_key;
}

const external_audience_scopes = new Set<ApiKeyScope>([
  'answers.write',
  'memory.read',
  'memory.write',
]);

export function scope_requires_internal_audience(scope: ApiKeyScope): boolean {
  return !external_audience_scopes.has(scope);
}

export function assert_api_key_scope(api_key: ApiKey, required_scope: ApiKeyScope): void {
  if (!api_key_holds_scope(api_key, required_scope)) {
    throw new AppError(
      'scope_missing',
      `This API key is missing the '${required_scope}' scope`,
      403,
      { scope: required_scope },
    );
  }
  if (scope_requires_internal_audience(required_scope) && api_key.key_audience !== 'internal') {
    throw new AppError(
      'scope_missing',
      `The '${required_scope}' scope is only available to internal-audience API keys`,
      403,
      { scope: required_scope, key_audience: api_key.key_audience },
    );
  }
}

export function api_key_can_use_scope(api_key: ApiKey, scope: ApiKeyScope): boolean {
  if (!api_key_holds_scope(api_key, scope)) return false;
  return !scope_requires_internal_audience(scope) || api_key.key_audience === 'internal';
}

function api_key_holds_scope(api_key: ApiKey, scope: ApiKeyScope): boolean {
  if (api_key.scopes.includes(scope)) return true;
  if (!scope.endsWith('.read') || !scope_requires_internal_audience(scope)) return false;
  const write_scope = `${scope.slice(0, -'.read'.length)}.write`;
  return api_key.scopes.some((held_scope) => held_scope === write_scope);
}

async function charge_api_key_request(c: ApiKeyRequestContext, api_key: ApiKey): Promise<void> {
  const window = await count_api_key_request_in_window(c.get('db'), {
    api_key_id: api_key.api_key_id,
    window_ms: api_key_rate_window_ms,
    request_limit: api_key_requests_per_window,
  });
  const remaining = Math.max(api_key_requests_per_window - window.request_count, 0);
  c.header('X-RateLimit-Limit', String(api_key_requests_per_window));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(seconds_until_window_rolls()));
  c.set('api_key_rate_remaining', remaining);
  if (window.allowed) return;

  const retry_after_seconds = Math.ceil(api_key_rate_window_ms / 1000);
  c.header('Retry-After', String(retry_after_seconds));
  throw new AppError('rate_limited', 'Rate limit exceeded. Retry in a moment.', 429, {
    retry_after_seconds,
  });
}

function seconds_until_window_rolls(): number {
  const now = Date.now();
  const window_end = (Math.floor(now / api_key_rate_window_ms) + 1) * api_key_rate_window_ms;
  return Math.ceil((window_end - now) / 1000);
}

export function describe_api_key(api_key: ApiKey, remaining?: number) {
  return {
    api_key_id: api_key.api_key_id,
    key_prefix: api_key.key_prefix,
    key_name: api_key.key_name,
    key_audience: api_key.key_audience,
    scopes: api_key.scopes,
    workspace_id: api_key.workspace_id,
    rate_limit: {
      window_seconds: Math.round(api_key_rate_window_ms / 1000),
      max_requests: api_key_requests_per_window,
      ...(remaining === undefined ? {} : { remaining }),
    },
  };
}

function read_presented_secret(request: Request): string {
  const bearer = request.headers.get('authorization');
  if (bearer?.toLowerCase().startsWith('bearer ')) return bearer.slice('bearer '.length).trim();
  const header_key = request.headers.get('x-api-key');
  if (header_key) return header_key.trim();
  throw new AppError('api_key_invalid', 'Send the API key as Authorization: Bearer <key>', 401);
}
