import type { ApiEnv } from '@api/lib/context';
import { Hono } from 'hono';

export const openai_apps_challenge_routes = new Hono<ApiEnv>();
