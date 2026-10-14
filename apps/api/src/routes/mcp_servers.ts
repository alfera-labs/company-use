import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { authorize_mcp_server_administration } from '@api/services/workspace_admin_access';
import { public_env } from '@coworker/config/public_env';
import { AppError } from '@coworker/shared';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import { inspect_mcp_server } from '@runtime-platform/connections/mcp_server_inspection';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';
import { Hono } from 'hono';
import { z } from 'zod';

const max_request_headers = 4;

const inspect_mcp_server_schema = z.object({
  server_url: z.string().min(1).max(2048),
});

const add_mcp_server_schema = z.object({
  server_url: z.string().min(1).max(2048),
  display_name: z.string().min(1).max(160).optional(),
  access_token: z.string().trim().min(1).max(4096).optional(),
  oauth_client: z
    .object({
      client_id: z.string().trim().min(1).max(512),
      client_secret: z.string().trim().min(1).max(4096).optional(),
    })
    .strict()
    .optional(),
  authentication: z.enum(['always', 'when_asked', 'none']).optional(),
  request_headers: z
    .array(
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Header name is not a valid HTTP header.'),
          value: z.string().min(1).max(4096),
        })
        .strict(),
    )
    .max(max_request_headers)
    .optional(),
});

export const mcp_server_routes = new Hono<ApiEnv>()
  .post('/v1/mcp-servers/inspect', validate_json(inspect_mcp_server_schema), async (c) => {
    await authorize_mcp_server_administration(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });

    const inspection = await inspect_mcp_server({
      server_url: c.req.valid('json').server_url,
      asked_by: 'administrator_in_dashboard',
    });
    if (!inspection.inspected) {
      throw new AppError('mcp_server_refused', inspection.because, 422);
    }
    return c.json(ok(inspection));
  })
  .post('/v1/mcp-servers', validate_json(add_mcp_server_schema), async (c) => {
    await authorize_mcp_server_administration(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });

    const body = c.req.valid('json');
    const outcome = await define_mcp_client_connection({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      server_url: body.server_url,
      ...(body.display_name ? { display_name: body.display_name } : {}),
      ...(body.access_token ? { access_token: body.access_token } : {}),
      ...(body.oauth_client ? { oauth_client: body.oauth_client } : {}),
      ...(body.authentication ? { authentication: body.authentication } : {}),
      ...(body.request_headers?.length
        ? { request_headers: read_request_headers(body.request_headers) }
        : {}),
      redirect_uri: build_connection_return_url(),
      asked_by: 'administrator_in_dashboard',
    });

    if (outcome.kind === 'refused') {
      throw new AppError('mcp_server_refused', outcome.because, 422);
    }

    return c.json(ok(outcome), 201);
  })
  .post('/v1/mcp-servers/:app_id/sync', async (c) => {
    await authorize_mcp_server_administration(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });

    const outcome = await sync_mcp_server_tools({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      app_id: c.req.param('app_id'),
      actor_id: c.get('user_id'),
    });
    if (!outcome.synced) {
      throw new AppError('mcp_sync_failed', outcome.because, 422);
    }

    return c.json(ok(outcome));
  });

function read_request_headers(headers: Array<{ name: string; value: string }>) {
  return Object.fromEntries(headers.map((header) => [header.name, header.value]));
}

function build_connection_return_url() {
  return new URL('/connect/callback', public_env.NEXT_PUBLIC_APP_URL).toString();
}
