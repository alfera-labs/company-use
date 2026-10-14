import type { ApiEnv } from '@api/lib/context';
import { Hono } from 'hono';

export const memory_dashboard_proposal_routes = new Hono<ApiEnv>();
