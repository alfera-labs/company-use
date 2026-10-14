import type { ApiEnv } from '@api/lib/context';
import { error_body, ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  create_workspace_credential_for_user,
  disable_workspace_credential_for_user,
  list_workspace_credentials_for_user,
} from '@api/services/credentials/connection_credential_service';
import { list_credential_type_choices } from '@api/services/credentials/credential_type_catalog';
import { credential_delivery_rule_schema } from '@coworker/core/credentials/app_credential_config';
import { credential_exchange_method_schema } from '@coworker/core/credentials/credential_exchange';
import { NotFoundError } from '@coworker/shared';
import {
  complete_app_sign_in,
  find_app_sign_in_form,
} from '@runtime-platform/connections/app_sign_in_setup_service';
import { exchange_credential_for_connection } from '@runtime-platform/connections/credential_exchange_service';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const create_workspace_credential_schema = z
  .object({
    display_name: z.string(),
    allowed_hosts: z.array(z.string()),
    secret_values: z.record(z.string(), z.string()),
    add_to_every_request: z.array(credential_delivery_rule_schema).optional(),
    credential_type_key: z.string().optional(),
    custom_headers: z
      .array(z.object({ name: z.string(), prefix: z.string().optional(), value: z.string() }))
      .optional(),
    exchange_the_credential_by: credential_exchange_method_schema.optional(),
  })
  .strict();

const complete_app_sign_in_schema = z
  .object({ sign_in_name: z.string().min(1), password: z.string().min(1) })
  .strict();

const service_error_statuses = {
  display_name_required: 400,
  allowed_hosts_required: 400,
  secret_value_required: 400,
  wildcard_host_not_supported: 400,
  host_not_allowed: 400,
  connection_not_found: 404,
} as const;

export const connection_credential_routes = new Hono<ApiEnv>()
  .get('/v1/connection-credential-types', (c) => {
    return c.json(ok({ credential_types: list_credential_type_choices() }));
  })
  .get('/v1/connection-credentials', async (c) => {
    const credentials = await list_workspace_credentials_for_user({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
    });
    return c.json(ok({ credentials }));
  })
  .post(
    '/v1/connection-credentials',
    validate_json(create_workspace_credential_schema),
    async (c) => {
      try {
        const body = c.req.valid('json');
        const credential = await create_workspace_credential_for_user({
          db: c.get('db'),
          workspace_id: c.get('workspace_id'),
          created_by: c.get('user_id'),
          ...body,
        });
        return c.json(ok(credential));
      } catch (error) {
        return service_error_response(c, error);
      }
    },
  )
  .post('/v1/connection-credentials/:connection_id/exchange', async (c) => {
    try {
      const report = await exchange_credential_for_connection({
        db: c.get('db'),
        workspace_id: c.get('workspace_id'),
        connection_id: c.req.param('connection_id'),
      });
      return c.json(ok(report));
    } catch (error) {
      return service_error_response(c, error);
    }
  })
  .get('/v1/app-sign-in/:connection_id', async (c) => {
    const form = await find_app_sign_in_form({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      connection_id: c.req.param('connection_id'),
    });
    if (!form) throw new NotFoundError('Connection');
    return c.json(ok(form));
  })
  .post('/v1/app-sign-in/:connection_id', validate_json(complete_app_sign_in_schema), async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await complete_app_sign_in({
        db: c.get('db'),
        workspace_id: c.get('workspace_id'),
        actor_id: c.get('user_id'),
        connection_id: c.req.param('connection_id'),
        ...body,
      });
      return c.json(ok(result));
    } catch (error) {
      return service_error_response(c, error);
    }
  })
  .delete('/v1/connection-credentials/:connection_id', async (c) => {
    const result = await disable_workspace_credential_for_user({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      connection_id: c.req.param('connection_id'),
    });
    return c.json(ok(result));
  });

function service_error_response(context: Context<ApiEnv>, error: unknown): Response {
  if (!(error instanceof Error)) throw error;
  const status = service_error_statuses[error.message as keyof typeof service_error_statuses];
  if (status) return context.json(error_body(error.message, error.message), status);
  throw error;
}
