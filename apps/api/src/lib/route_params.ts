import type { ApiEnv } from '@api/lib/context';
import { ValidationError } from '@coworker/shared';
import type { Context } from 'hono';

export function require_route_param(c: Context<ApiEnv>, key: string) {
  const value = c.req.param(key);
  if (!value) throw new ValidationError(`Missing route parameter: ${key}`);
  return value;
}
