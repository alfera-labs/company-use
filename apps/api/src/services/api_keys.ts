import { scope_requires_internal_audience } from '@api/lib/api_key_auth';
import { authorize_api_key_administration } from '@api/services/workspace_admin_access';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { find_or_create_alfera_api_connection } from '@coworker/core/db/queries/alfera_api_connection';
import {
  type ApiKey,
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
  list_workspace_api_keys,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { keep_offered_scopes, NotFoundError, ValidationError } from '@coworker/shared';

const every_api_key_scope = [
  'answers.write',
  'memory.read',
  'memory.write',
  'agents.read',
  'agents.write',
  'sessions.read',
  'sessions.write',
  'projects.read',
  'automations.read',
  'automations.write',
  'skills.read',
  'usage.read',
  'integrations.read',
  'workspace.read',
  'workspace.write',
  'chat.completions',
] as const satisfies readonly ApiKeyScope[];

export const all_api_key_scopes = keep_offered_scopes(every_api_key_scope);

export async function mint_workspace_api_key(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    key_name: string;
    scopes: ApiKeyScope[];
    key_audience: ApiKeyAudience;
    expires_time?: Date | undefined;
  },
): Promise<{ api_key: ApiKey; secret: string }> {
  await authorize_api_key_administration(db, input);
  if (input.scopes.length === 0) {
    throw new ValidationError('An API key needs at least one scope');
  }
  assert_scopes_match_audience(input.scopes, input.key_audience);
  await find_or_create_alfera_api_connection(db, input.workspace_id);
  return create_api_key(db, {
    workspace_id: input.workspace_id,
    key_name: input.key_name,
    scopes: input.scopes,
    key_audience: input.key_audience,
    ...(input.expires_time ? { expires_time: input.expires_time } : {}),
    environment_label: env.ENVIRONMENT === 'production' ? 'live' : 'test',
    actor_id: input.user_id,
  });
}

function assert_scopes_match_audience(scopes: ApiKeyScope[], key_audience: ApiKeyAudience) {
  if (key_audience === 'internal') return;
  const refused = scopes.filter(scope_requires_internal_audience);
  if (refused.length === 0) return;
  throw new ValidationError(
    `An external-audience key cannot hold ${refused.join(', ')}: these scopes are internal-only. Write scopes drive the workspace's agents and change its setup; read scopes expose workspace-wide data (sessions, automations, spend, integrations, the workspace itself) that an outside audience must not see.`,
    { scopes: refused, key_audience },
  );
}

export async function list_workspace_api_keys_for_user(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<ApiKey[]> {
  await authorize_api_key_administration(db, input);
  return list_workspace_api_keys(db, input.workspace_id);
}

export async function revoke_workspace_api_key(
  db: Database,
  input: { workspace_id: string; api_key_id: string; user_id: string },
): Promise<ApiKey> {
  await authorize_api_key_administration(db, input);
  const revoked = await revoke_api_key(db, { ...input, actor_id: input.user_id });
  if (!revoked) throw new NotFoundError('API key');
  return revoked;
}
