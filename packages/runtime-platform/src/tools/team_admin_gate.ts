import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { resolve_user_id_for_source_actor } from '@coworker/core/db/queries/source_actors';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { is_workspace_administrator_role } from '@coworker/shared';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

/**
 * The refusal for a tool that changes something the whole team shares, or null when the run
 * may go on. In team mode only an owner or an admin changes such a thing, in the dashboard and
 * through the coworker alike: a tool must not be the way around the role a route checks.
 * The person is the one who speaks in the run when that is known, and else the one the run
 * acts for. A run no person started (a scheduled task, an API key, a mail from outside) has no
 * role, so it is refused too. Outside team mode nothing is refused here.
 */
export async function refuse_a_plain_member_in_team_mode(
  context: RuntimeToolExecutionContext,
  only_they_can: string,
) {
  if (!is_team_mode_switched_on()) return null;
  const speaker_id = context.speaker?.source_actor_id;
  const user_id = speaker_id
    ? await resolve_user_id_for_source_actor(context.db, {
        workspace_id: context.workspace_id,
        source_actor_id: speaker_id,
      })
    : context.actor_id;
  const role = user_id
    ? await find_active_workspace_member_role(context.db, {
        workspace_id: context.workspace_id,
        user_id,
      })
    : null;
  if (is_workspace_administrator_role(role)) return null;
  return {
    success: false as const,
    error: { code: 'team_access_denied', message: only_they_can },
  };
}
