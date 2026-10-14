import type { ApiEnv } from '@api/lib/context';
import { Hono } from 'hono';

export const brain_source_routes = new Hono<ApiEnv>();
