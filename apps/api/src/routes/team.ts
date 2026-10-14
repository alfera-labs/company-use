import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import {
  team_members_list_their_own_credentials,
  team_members_manage_their_own_credentials,
} from '@api/lib/team_credential_routes';
import {
  never_in_team_mode,
  only_in_team_mode,
  team_admins_only_write,
} from '@api/lib/team_mode_routes';
import {
  team_members_list_their_own_tasks,
  team_members_manage_their_own_tasks,
} from '@api/lib/team_task_routes';
import { validate_json, validate_query } from '@api/lib/validate';
import { attach_workspace } from '@api/middleware';
import { team_roles } from '@api/services/team/team_change_refusal';
import {
  list_connections_of_member,
  remove_team_member,
} from '@api/services/team/team_member_removal';
import {
  change_team_member_role,
  invite_team_member,
  list_team,
  make_member_sign_in_link,
  mark_sign_in_notice_seen,
  read_own_account,
  read_team_arrival,
  set_own_match_email,
  set_own_name,
  sign_out_everywhere,
} from '@api/services/team/team_members';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

const match_email_schema = z.string().trim().toLowerCase().email().max(254);
const invitation_schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(team_roles),
    email: match_email_schema.optional(),
  })
  .strict();
const own_name_schema = z.strictObject({ name: z.string().trim().min(1).max(120) });
const own_account_schema = z.strictObject({ match_email: match_email_schema.nullable() });
const member_role_schema = z.object({ role: z.enum(team_roles) }).strict();
const removal_query_schema = z.strictObject({
  keep_connections: z.enum(['true', 'false']).optional(),
});

const only_admins_change_the_coworker = team_admins_only_write(
  'Only an owner or an admin can change the coworker the team shares.',
);
const only_admins_set_the_workspace_up = team_admins_only_write(
  'Only an owner or an admin can set the workspace up.',
);

const only_admins_change_the_team_address = team_admins_only_write(
  'Only an owner or an admin can set, rename or switch off the address the team gets mail at.',
);

function team_actor(c: Context<ApiEnv>) {
  return { workspace_id: c.get('workspace_id'), actor_id: c.get('user_id') };
}

function team_target(c: Context<ApiEnv>) {
  return { ...team_actor(c), user_id: c.req.param('user_id') ?? '' };
}

/**
 * The team page's routes, plus the guards team mode puts in front of older routes: it closes
 * the sign-in provider's own people routes, which would change a seat without the rule that the
 * last owner stays, it lets only an owner or an admin change the coworker everyone shares or
 * set the workspace up or change the address the team gets mail at, and it keeps each member to
 * the scheduled tasks and the stored credentials they made.
 * Who may do what is decided in the service, on the role stored for the signed-in person.
 */
export const team_routes = new Hono<ApiEnv>()
  .use('/v1/auth/*', never_in_team_mode)
  .use('/v1/workspace/members/:user_id', never_in_team_mode)
  .use('/v1/workspace/invitations', never_in_team_mode)
  .use('/v1/workspace/invitations/*', never_in_team_mode)
  .use('/v1/agents/:agent_id', only_admins_change_the_coworker)
  .use('/v1/agents/:agent_id/enabled-nodes', only_admins_change_the_coworker)
  .use('/v1/onboarding/*', only_admins_set_the_workspace_up)
  .use('/v1/workspace/email-address', only_admins_change_the_team_address)
  .use('/v1/connection-credentials', team_members_list_their_own_credentials)
  .use('/v1/connection-credentials/:connection_id', team_members_manage_their_own_credentials)
  .use('/v1/connection-credentials/:connection_id/*', team_members_manage_their_own_credentials)
  .use('/v1/app-sign-in/:connection_id', team_members_manage_their_own_credentials)
  .use('/v1/triggers', team_members_list_their_own_tasks)
  .use('/v1/triggers/:trigger_id', team_members_manage_their_own_tasks)
  .use('/v1/triggers/:trigger_id/*', team_members_manage_their_own_tasks)
  .use('/v1/team', only_in_team_mode, attach_workspace())
  .use('/v1/team/*', only_in_team_mode, attach_workspace())
  .get('/v1/team', async (c) => c.json(ok(await list_team(c.get('db'), team_actor(c)))))
  .post('/v1/team/invitations', validate_json(invitation_schema), async (c) => {
    const { name, role, email } = c.req.valid('json');
    const invited = await invite_team_member(c.get('db'), {
      ...team_actor(c),
      name,
      match_email: email,
      member_role: role,
    });
    return c.json(ok(invited), 201);
  })
  .post('/v1/team/members/:user_id/sign-in-link', async (c) => {
    return c.json(ok(await make_member_sign_in_link(c.get('db'), team_target(c))), 201);
  })
  .patch('/v1/team/members/:user_id', validate_json(member_role_schema), async (c) => {
    const member = await change_team_member_role(c.get('db'), {
      ...team_target(c),
      member_role: c.req.valid('json').role,
    });
    return c.json(ok(member));
  })
  .get('/v1/team/members/:user_id/connections', async (c) => {
    const connections = await list_connections_of_member(c.get('db'), team_target(c));
    return c.json(ok({ connections }));
  })
  .delete('/v1/team/members/:user_id', validate_query(removal_query_schema), async (c) => {
    const keeps_connections = c.req.valid('query').keep_connections === 'true';
    const removed = await remove_team_member(c.get('db'), { ...team_target(c), keeps_connections });
    return c.json(ok(removed));
  })
  .put('/v1/team/my-name', validate_json(own_name_schema), async (c) => {
    const { name } = c.req.valid('json');
    return c.json(ok(await set_own_name(c.get('db'), { ...team_actor(c), name })));
  })
  .get('/v1/team/me', async (c) => c.json(ok(await read_own_account(c.get('db'), team_actor(c)))))
  .patch('/v1/team/me', validate_json(own_account_schema), async (c) => {
    const account = { ...team_actor(c), ...c.req.valid('json') };
    return c.json(ok(await set_own_match_email(c.get('db'), account)));
  })
  .post('/v1/team/arrival', async (c) => {
    return c.json(ok(await read_team_arrival(c.get('db'), team_actor(c))));
  })
  .post('/v1/team/sign-in-notice/seen', async (c) => {
    await mark_sign_in_notice_seen(c.get('db'), team_actor(c));
    return c.json(ok({ seen: true }));
  })
  .post('/v1/team/sign-out-everywhere', async (c) => {
    await sign_out_everywhere(c.get('db'), team_actor(c));
    return c.json(ok({ signed_out: true }));
  });
