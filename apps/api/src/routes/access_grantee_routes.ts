import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  format_sharing_response,
  read_sharing_entry,
  type SharingEntryBody,
  sharing_entry_schema,
} from '@api/routes/access_sharing_schema';
import {
  add_audience_grantee,
  remove_audience_grantee,
} from '@api/services/access/resource_grantees';
import { ValidationError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const grantee_types = ['project', 'user', 'agent', 'api_key'] as const;
const one_resource = '/v1/access/:resource_type/:resource_id';
const one_grantee = `${one_resource}/grantees/:grantee_type/:grantee_id` as const;

export const access_grantee_routes = new Hono<ApiEnv>()
  .post(`${one_resource}/grantees`, validate_json(sharing_entry_schema), add_grantee)
  .delete(one_grantee, remove_grantee);

async function add_grantee(
  c: Context<
    ApiEnv,
    '/v1/access/:resource_type/:resource_id/grantees',
    { in: { json: SharingEntryBody }; out: { json: SharingEntryBody } }
  >,
) {
  const entry = read_sharing_entry(c.req.valid('json'));
  const grants = await add_audience_grantee(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
    resource_type: c.req.param('resource_type'),
    resource_id: c.req.param('resource_id'),
    entry,
  });
  return c.json(ok(format_sharing_response(c.req.param('resource_type'), grants)));
}

async function remove_grantee(
  c: Context<ApiEnv, '/v1/access/:resource_type/:resource_id/grantees/:grantee_type/:grantee_id'>,
) {
  const grantee_type_param = c.req.param('grantee_type');
  const parsed_grantee_type = z.enum(grantee_types).safeParse(grantee_type_param);
  if (!parsed_grantee_type.success) {
    throw new ValidationError(`Unknown grantee_type "${grantee_type_param}".`);
  }
  const grants = await remove_audience_grantee(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
    resource_type: c.req.param('resource_type'),
    resource_id: c.req.param('resource_id'),
    grantee: { grantee_type: parsed_grantee_type.data, grantee_id: c.req.param('grantee_id') },
  });
  return c.json(ok(format_sharing_response(c.req.param('resource_type'), grants)));
}
