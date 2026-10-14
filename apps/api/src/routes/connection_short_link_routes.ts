import type { ApiEnv } from '@api/lib/context';
import { public_env } from '@coworker/config/public_env';
import { find_connection_start_url_by_short_code } from '@coworker/runtime-platform';
import { Hono } from 'hono';

export const connection_short_link_routes = new Hono<ApiEnv>().get(
  '/v1/c/:short_code',
  async (c) => {
    const start_url = await find_connection_start_url_by_short_code(
      c.get('db'),
      c.req.param('short_code'),
    );
    return c.redirect(start_url ?? public_env.NEXT_PUBLIC_APP_URL, 302);
  },
);
