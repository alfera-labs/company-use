import { authenticate_api_key_request, describe_api_key } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { type Context, Hono } from 'hono';

export const public_me_routes = new Hono<ApiEnv>().get('/v1/me', read_me);

async function read_me(c: Context<ApiEnv>) {
  const api_key = await authenticate_api_key_request(c);
  return c.json(ok(describe_api_key(api_key, c.get('api_key_rate_remaining'))));
}
