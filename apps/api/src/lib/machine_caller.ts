import type { ApiEnv } from '@api/lib/context';
import { verify_machine_caller } from '@api/lib/proxy_identity';
import type { MiddlewareHandler } from 'hono';

export const machine_caller_only: MiddlewareHandler<ApiEnv> = async (c, next) => {
  verify_machine_caller(c);
  await next();
};
