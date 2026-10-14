import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { access_grantee_routes } from '@api/routes/access_grantee_routes';
import {
  format_sharing_response,
  read_replaced_entries,
  read_sharing_entries,
  type SetSharingBody,
  set_sharing_body_schema,
} from '@api/routes/access_sharing_schema';
import { read_access_table } from '@api/services/access/access_table';
import {
  assert_audience_editor,
  assert_everyone_is_a_thing_this_can_be,
  assert_parties_belong_to_workspace,
  read_resource_grants,
  read_resource_ref,
  refuse_memory_scope_write,
} from '@api/services/access/resource_audience';
import { authorize_access_table_reading } from '@api/services/workspace_admin_access';
import type { GranteeType } from '@coworker/core/access/may_use_resource';
import { find_resource_type_definition } from '@coworker/core/access/resource_types';
import {
  list_grants_for_grantee,
  replace_resource_sharing,
} from '@coworker/core/db/queries/resource_grants';
import { ValidationError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const grantee_query_types = ['project', 'user', 'agent', 'api_key'] as const;

const grantee_query_schema = z
  .object({
    grantee_type: z.enum(grantee_query_types),
    grantee_id: z.string().min(1),
    resource_type: z.string().min(1).optional(),
  })
  .strict();

type GranteeQuery = z.infer<typeof grantee_query_schema>;

const one_resource = '/v1/access/:resource_type/:resource_id';

export const access_routes = new Hono<ApiEnv>()
  .get('/v1/access', validate_query(grantee_query_schema), list_for_grantee)
  .get('/v1/access/table', read_table)
  .get(one_resource, read_sharing)
  .put(one_resource, validate_json(set_sharing_body_schema), set_sharing)
  .route('/', access_grantee_routes);

async function list_for_grantee(
  c: Context<ApiEnv, '/v1/access', { in: { query: GranteeQuery }; out: { query: GranteeQuery } }>,
) {
  const query = c.req.valid('query');
  if (query.resource_type && !find_resource_type_definition(query.resource_type)) {
    throw new ValidationError(`Unknown resource_type "${query.resource_type}".`);
  }
  const grants = await list_grants_for_grantee(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    grantee_type: query.grantee_type as GranteeType,
    grantee_id: query.grantee_id,
    ...(query.resource_type === undefined ? {} : { resource_type: query.resource_type }),
  });
  return c.json(ok({ grants }));
}

async function read_table(c: Context<ApiEnv, '/v1/access/table'>) {
  const workspace = { workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
  await authorize_access_table_reading(c.get('db'), workspace);
  return c.json(ok(await read_access_table(c.get('db'), workspace.workspace_id)));
}

async function read_sharing(c: Context<ApiEnv, '/v1/access/:resource_type/:resource_id'>) {
  const resource = await resolve_resource_ref(c);
  const grants = await read_resource_grants(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    ...resource,
  });
  return c.json(ok(format_sharing_response(resource.resource_type, grants)));
}

async function set_sharing(
  c: Context<
    ApiEnv,
    '/v1/access/:resource_type/:resource_id',
    { in: { json: SetSharingBody }; out: { json: SetSharingBody } }
  >,
) {
  const resource = await resolve_resource_ref(c);
  refuse_memory_scope_write(resource.resource_type);
  const body = c.req.valid('json');
  await assert_audience_editor(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
    resource,
  });
  assert_everyone_is_a_thing_this_can_be(
    resource.resource_type,
    body.shared_with_everyone_in_the_workspace,
  );

  const shared_with = read_sharing_entries(body);
  await assert_parties_belong_to_workspace(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    parties: shared_with,
  });
  const grants = await replace_resource_sharing(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    resource_type: resource.resource_type,
    resource_id: resource.resource_id,
    shared_with,
    replaces: read_replaced_entries(body),
    actor_id: c.get('user_id'),
  });
  return c.json(ok(format_sharing_response(resource.resource_type, grants)));
}

async function resolve_resource_ref(c: Context<ApiEnv>) {
  return read_resource_ref(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    resource_type: c.req.param('resource_type') ?? '',
    resource_id: c.req.param('resource_id') ?? '',
  });
}
