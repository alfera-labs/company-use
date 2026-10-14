import { read_client_address } from '@api/lib/client_address';
import type { ApiEnv } from '@api/lib/context';
import { read_company_use_deploy_env } from '@coworker/config/company_use_deploy_env';
import { AppError } from '@coworker/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

export const deploy_rate_limits = {
  start: { limit: 20, seconds: 3600 },
  report: { limit: 1200, seconds: 3600 },
  report_per_install: { limit: 300, seconds: 86_400 },
  status: { limit: 3000, seconds: 3600 },
  digitalocean_token: { limit: 40, seconds: 3600 },
  digitalocean_revoke: { limit: 400, seconds: 3600 },
} as const;

type DeployRateLimitName = keyof typeof deploy_rate_limits;

// Counted in this process, like the trigger delivery cap. With N API instances a caller
// gets N times the limit; move the count into Postgres if that matters.
const windows_by_limit = new Map<
  DeployRateLimitName,
  { window: number; counts: Map<string, number> }
>();

function count_request(name: DeployRateLimitName, caller: string) {
  const window = Math.floor(Date.now() / 1000 / deploy_rate_limits[name].seconds);
  const current = windows_by_limit.get(name);
  const counted = current?.window === window ? current : { window, counts: new Map() };
  windows_by_limit.set(name, counted);
  const count = (counted.counts.get(caller) ?? 0) + 1;
  counted.counts.set(caller, count);
  return count;
}

export function require_under_rate_limit(c: Context, name: DeployRateLimitName, key: string) {
  if (count_request(name, key) <= deploy_rate_limits[name].limit) return;
  const retry_after_seconds = deploy_rate_limits[name].seconds;
  c.header('Retry-After', String(retry_after_seconds));
  throw new AppError('rate_limited', 'Too many requests. Try again later.', 429, {
    retry_after_seconds,
  });
}

export function limit_deploy_requests(name: DeployRateLimitName): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    require_under_rate_limit(c, name, read_client_address(c));
    await next();
  };
}

export function forget_deploy_request_counts() {
  windows_by_limit.clear();
}

export function allow_only_the_deploy_page(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const origins = read_company_use_deploy_env().page_origins;
    if (origins.length === 0) throw new AppError('not_found', 'Route not found', 404);
    return cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    })(c, next);
  };
}

export function read_bearer_token(c: Context) {
  const header = c.req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}
