import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import {
  list_api_integration_tools,
  list_api_integrations,
} from '@api/services/integrations_api/integration_reads';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { type Context, Hono } from 'hono';

export const public_integration_routes = new Hono<ApiEnv>()
  .get('/v1/integrations', key_authed_route('integrations.read', list_integrations))
  .get(
    '/v1/integrations/:integration_key/tools',
    key_authed_route('integrations.read', list_integration_tools),
  );

async function list_integrations(c: Context<ApiEnv>, api_key: ApiKey) {
  const integrations = await list_api_integrations(c.get('db'), api_key);
  return c.json(ok(integrations));
}

async function list_integration_tools(c: Context<ApiEnv>, api_key: ApiKey) {
  const tools = await list_api_integration_tools(
    c.get('db'),
    api_key,
    require_route_param(c, 'integration_key'),
  );
  return c.json(ok(tools));
}
