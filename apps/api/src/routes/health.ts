import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { Hono } from 'hono';

export const health_routes = new Hono<ApiEnv>().get('/health', (c) => {
  return c.json(ok({ status: 'ok' }));
});
