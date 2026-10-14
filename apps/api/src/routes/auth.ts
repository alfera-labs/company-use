import type { ApiEnv } from '@api/lib/context';
import {
  active_organization_schema,
  clean_workspace_identity,
  create_workspace_schema,
  require_proxy_identity,
  require_proxy_identity_with_body,
  verify_machine_caller,
  verify_proxy_secret,
  workspace_identity_schema,
} from '@api/lib/proxy_identity';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  create_user_workspace,
  list_workspace_invitations_to_offer,
  provision_personal_workspace,
  provision_workspace_for_authenticated_user,
  set_active_organization,
} from '@api/services/workspace';
import { Hono, type MiddlewareHandler } from 'hono';

const authenticate_proxy_request: MiddlewareHandler<ApiEnv> = async (c, next) => {
  verify_proxy_secret(c);
  await next();
};

const only_the_dashboard_server_names_an_identity: MiddlewareHandler<ApiEnv> = async (c, next) => {
  verify_machine_caller(c);
  await next();
};

export const auth_routes = new Hono<ApiEnv>()
  .post(
    '/v1/auth/workspace',
    only_the_dashboard_server_names_an_identity,
    validate_json(workspace_identity_schema),
    async (c) => {
      const identity = clean_workspace_identity(c.req.valid('json'));
      const workspace = await provision_workspace_for_authenticated_user(c.get('db'), identity);
      return c.json(ok(workspace), 201);
    },
  )
  .get('/v1/auth/workspace-invitations', async (c) => {
    const identity = require_proxy_identity(c);
    const invitations = await list_workspace_invitations_to_offer(identity);
    return c.json(ok({ invitations }));
  })
  .post(
    '/v1/auth/workspace/personal',
    authenticate_proxy_request,
    validate_json(workspace_identity_schema),
    async (c) => {
      const body_identity = c.req.valid('json');
      const identity = require_proxy_identity_with_body(c, body_identity);
      const workspace = await provision_personal_workspace(c.get('db'), identity);
      return c.json(ok(workspace), 201);
    },
  )
  .post(
    '/v1/auth/active-organization',
    only_the_dashboard_server_names_an_identity,
    validate_json(active_organization_schema),
    async (c) => {
      const input = c.req.valid('json');
      await set_active_organization(c.get('db'), input);
      return c.json(ok({ ok: true }));
    },
  )
  .post(
    '/v1/auth/workspace/create',
    only_the_dashboard_server_names_an_identity,
    validate_json(create_workspace_schema),
    async (c) => {
      const { name, ...raw_identity } = c.req.valid('json');
      const identity = clean_workspace_identity(raw_identity);
      const created = await create_user_workspace(c.get('db'), { identity, name });
      return c.json(ok(created), 201);
    },
  );
