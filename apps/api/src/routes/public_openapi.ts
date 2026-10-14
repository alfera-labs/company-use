import type { ApiEnv } from '@api/lib/context';
import {
  build_public_api_openapi_document,
  describe_public_api_server,
} from '@api/services/openapi/public_api_openapi';
import { env } from '@coworker/config';
import { Hono } from 'hono';

const openapi_document = build_public_api_openapi_document();

export const public_openapi_routes = new Hono<ApiEnv>().get('/v1/openapi.json', (c) =>
  c.json({
    ...openapi_document,
    servers: [
      describe_public_api_server({
        is_self_hosted: env.COWORKER_SELF_HOSTED,
        public_api_url: env.API_PUBLIC_URL,
        request_url: c.req.url,
      }),
    ],
  }),
);
