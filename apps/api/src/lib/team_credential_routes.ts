import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { attach_workspace } from '@api/middleware';
import { list_workspace_credentials_for_user } from '@api/services/credentials/connection_credential_service';
import { keep_credentials_person_manages } from '@api/services/team/team_credentials';
import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { NotFoundError } from '@coworker/shared';
import type { Context, MiddlewareHandler } from 'hono';

function person_of(c: Context<ApiEnv>) {
  return { workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
}

/**
 * In team mode the list of stored credentials holds only the ones the person manages: the ones
 * they made, or every one for an owner or an admin. This answers the list itself, so the route
 * behind it never hands a member the whole list. Outside team mode, and for every other
 * method, the request goes on untouched.
 */
export const team_members_list_their_own_credentials: MiddlewareHandler<ApiEnv> = async (
  c,
  next,
) => {
  if (!is_team_mode_switched_on() || c.req.method !== 'GET') return next();
  await attach_workspace()(c, async () => {});
  const db = c.get('db');
  const every_credential = await list_workspace_credentials_for_user({ db, ...person_of(c) });
  const credentials = await keep_credentials_person_manages(db, person_of(c), every_credential);
  return c.json(ok({ credentials }));
};

/**
 * In team mode a member exchanges, signs in to or switches off only a stored credential they
 * made. Another person's answers "not found". Outside team mode nothing is checked.
 */
export const team_members_manage_their_own_credentials: MiddlewareHandler<ApiEnv> = async (
  c,
  next,
) => {
  if (!is_team_mode_switched_on()) return next();
  await attach_workspace()(c, async () => {});
  const connection = { connection_id: c.req.param('connection_id') ?? '' };
  const managed = await keep_credentials_person_manages(c.get('db'), person_of(c), [connection]);
  if (managed.length === 0) throw new NotFoundError('Connection');
  await next();
};
