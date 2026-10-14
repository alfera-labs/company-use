import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { list_apps } from '@coworker/core/db/queries/catalog';
import { create_pending_connection_setup } from '@coworker/core/db/queries/connection_management';
import { AppError, ValidationError } from '@coworker/shared';
import { build_public_connection_setup } from '@runtime-platform/connections/oauth_connection_setup';
import { Hono } from 'hono';
import { z } from 'zod';

export const stub_routes = new Hono<ApiEnv>();

const oauth_start_schema = z
  .object({
    app_id: z.string().min(1).optional(),
    app_name: z.string().min(1).optional(),
    redirect_uri: z.string().url().optional(),
  })
  .refine((value) => value.app_id || value.app_name, {
    message: 'app_id or app_name is required',
  });

stub_routes.post('/v1/connections/oauth/start', validate_json(oauth_start_schema), async (c) => {
  const body = c.req.valid('json');
  const apps = await list_apps(c.get('db'), c.get('workspace_id'));
  const app = apps.find((candidate) =>
    body.app_id ? candidate.app_id === body.app_id : candidate.app_name === body.app_name,
  );

  if (!app) {
    throw new ValidationError('App was not found for OAuth setup');
  }

  if (app.auth_type !== 'oauth2') {
    throw new AppError(
      'oauth_not_supported',
      `${app.app_display_name} does not use OAuth setup`,
      422,
      {
        app_id: app.app_id,
        app_name: app.app_name,
        auth_type: app.auth_type,
      },
    );
  }

  const result = await create_pending_connection_setup(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    app_id: app.app_id,
    actor_id: c.get('user_id'),
    ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
  });
  const setup = await build_public_connection_setup({
    provider_key: result.connection.provider_key,
    setup_state: result.setup,
    db: c.get('db'),
    ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
    request_origin: c.req.header('origin'),
  });

  return c.json(
    ok({
      app_id: app.app_id,
      app_name: app.app_name,
      connection_id: result.connection.connection_id,
      connection_status: result.connection.connection_status,
      setup,
      authorization_url: (setup as { authorization_url?: string }).authorization_url ?? null,
    }),
  );
});
