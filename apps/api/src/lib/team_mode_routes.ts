import type { ApiEnv } from '@api/lib/context';
import { attach_workspace } from '@api/middleware';
import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';
import type { MiddlewareHandler } from 'hono';

/**
 * A team-mode route does not exist for any other install. There it answers exactly as an
 * address with no route does: first the check of who is asking, then "not found".
 */
export const only_in_team_mode: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (is_team_mode_switched_on()) return next();
  await attach_workspace()(c, async () => {});
  throw new AppError('not_found', 'Route not found', 404);
};

/**
 * A route that makes or manages people through the sign-in provider. In team mode only an
 * invitation makes a person, there is one workspace, and the last owner stays, so these must
 * not change a seat behind those rules.
 */
export const never_in_team_mode: MiddlewareHandler<ApiEnv> = async (_c, next) => {
  if (is_team_mode_switched_on()) {
    throw new AppError('not_found', 'Team mode manages people at /v1/team', 404);
  }
  await next();
};

const methods_that_change_nothing = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A guard for something the whole team shares: in team mode only an owner or an admin may
 * change it, and the refusal says `only_they_can`. Outside team mode the guard does nothing,
 * and reading is open to every member in every mode.
 */
export function team_admins_only_write(only_they_can: string): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (!is_team_mode_switched_on() || methods_that_change_nothing.has(c.req.method)) return next();
    await attach_workspace()(c, async () => {});
    const role = await find_active_workspace_member_role(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });
    if (!is_workspace_administrator_role(role)) {
      throw new AppError('team_access_denied', only_they_can, 403);
    }
    await next();
  };
}
