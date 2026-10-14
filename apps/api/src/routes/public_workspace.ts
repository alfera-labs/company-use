import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { parse_json_body } from '@api/lib/validate';
import { key_authed_tool_route } from '@api/services/policies/alfera_api_tool_gate';
import { rename_workspace } from '@api/services/workspace';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import {
  find_workspace_profile,
  type WorkspaceProfile,
} from '@coworker/core/db/queries/workspace_provisioning';
import { NotFoundError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

type PublicWorkspace = { workspace_id: string; name: string; slug: string };

export const rename_workspace_body_schema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export const public_workspace_routes = new Hono<ApiEnv>()
  .get('/v1/workspace', key_authed_route('workspace.read', read_public_workspace))
  .patch(
    '/v1/workspace',
    key_authed_tool_route('workspace.write', 'rename_workspace', rename_public_workspace),
  );

async function read_public_workspace(c: Context<ApiEnv>, api_key: ApiKey) {
  const profile = await find_workspace_profile(c.get('db'), api_key.workspace_id);
  return c.json(ok(public_workspace(profile)));
}

async function rename_public_workspace(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, rename_workspace_body_schema);
  const profile = await rename_workspace(c.get('db'), {
    workspace_id: api_key.workspace_id,
    workspace_name: body.name,
    actor_id: api_key.api_key_id,
  });
  return c.json(ok(public_workspace(profile)));
}

function public_workspace(profile: WorkspaceProfile | null): PublicWorkspace {
  if (!profile) throw new NotFoundError('Workspace');
  return {
    workspace_id: profile.workspace_id,
    name: profile.workspace_name,
    slug: profile.workspace_slug,
  };
}
