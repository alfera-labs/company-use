import type { ApiEnv } from '@api/lib/context';
import { Hono } from 'hono';

export const brain_webhook_routes = new Hono<ApiEnv>();
