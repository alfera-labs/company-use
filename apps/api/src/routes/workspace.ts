import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  list_team_invitations,
  revoke_team_invitation,
  send_team_invitation,
  workos_environment_required,
} from '@api/lib/workos_invitations';
import { workos_admin_role_slug, workos_member_role_slug } from '@api/lib/workos_memberships';
import {
  find_workspace_organization_id,
  list_user_workspaces,
  rename_workspace,
} from '@api/services/workspace';
import { authorize_team_administration } from '@api/services/workspace_admin_access';
import { change_workspace_member_role } from '@api/services/workspace_member_role_service';
import { list_workspace_slack_people } from '@api/services/workspace_slack_people';
import { assert_volume_manager, redacted_volume } from '@api/services/workspace_volume_access';
import { env } from '@coworker/config';
import {
  count_active_workspace_members,
  type DatabaseExecutor,
  find_workspace_plan,
  lock_workspace_plan_capacity,
} from '@coworker/core';
import { find_volume } from '@coworker/core/db/queries/volumes';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import {
  find_active_slack_connection_for_workspace,
  provision_volume,
} from '@coworker/runtime-platform';
import { AppError, NotFoundError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const rename_schema = z.object({ workspace_name: z.string().trim().min(1).max(120) });

const member_role_schema = z.object({ role: z.enum(['member', 'admin']) }).strict();

const invitation_schema = z
  .object({
    email: z.email().max(320),
    role: z.enum(['member', 'admin']),
  })
  .strict();

export const workspace_routes = new Hono<ApiEnv>()
  .get('/v1/workspace', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const [workspace, slack_connection] = await Promise.all([
      find_workspace_profile(db, workspace_id),
      find_active_slack_connection_for_workspace(db, workspace_id),
    ]);
    if (!workspace) throw new NotFoundError('Workspace');
    return c.json(
      ok({
        ...workspace,
        slack_connected: Boolean(slack_connection),
        viewer_user_id: c.get('user_id'),
      }),
    );
  })
  .get('/v1/workspaces', async (c) => {
    const active_workspace_id = c.get('workspace_id');
    const workspaces = await list_user_workspaces(c.get('db'), c.get('user_id'));
    return c.json(
      ok({
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          is_active: workspace.workspace_id === active_workspace_id,
        })),
      }),
    );
  })
  .get('/v1/volumes', async (c) => {
    const volume = await find_volume(c.get('db'), c.get('workspace_id'));
    return c.json(ok(volume ? redacted_volume(volume) : null));
  })
  .post('/v1/volumes', async (c) => {
    await assert_volume_manager(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });
    if (!env.COWORKER_PERSISTENT_WORKSPACES_ENABLED) {
      throw new AppError(
        'persistent_workspaces_disabled',
        'Persistent workspaces are not enabled for this environment.',
        409,
      );
    }
    const volume = await provision_volume(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(redacted_volume(volume)), 201);
  })
  .get('/v1/workspace/members', async (c) => {
    const members = await list_workspace_member_users(c.get('db'), c.get('workspace_id'));
    return c.json(ok({ members }));
  })
  .patch('/v1/workspace/members/:user_id', validate_json(member_role_schema), async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    await authorize_team_administration(db, { workspace_id, user_id: c.get('user_id') });
    return c.json(
      ok(
        await change_workspace_member_role(db, {
          workspace_id,
          user_id: c.req.param('user_id'),
          member_role: c.req.valid('json').role,
          actor_id: c.get('user_id'),
        }),
      ),
    );
  })
  .get('/v1/workspace/invitations', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    await authorize_team_administration(db, { workspace_id, user_id: c.get('user_id') });
    const organization_id = await find_workspace_organization_id(db, workspace_id);
    const invitations = organization_id ? await list_team_invitations(organization_id) : [];
    return c.json(ok({ invitations }));
  })
  .post('/v1/workspace/invitations', validate_json(invitation_schema), async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    await authorize_team_administration(db, { workspace_id, user_id: c.get('user_id') });
    const { email, role } = c.req.valid('json');
    const invitation = await db.transaction(async (transaction) => {
      await lock_workspace_plan_capacity(transaction, workspace_id);
      const organization_id = await read_team_organization_id(transaction, workspace_id);
      await reject_invitation_above_plan_limit(transaction, workspace_id, organization_id);
      return send_team_invitation({
        organization_id,
        email,
        role_slug: role === 'admin' ? workos_admin_role_slug : workos_member_role_slug,
      });
    });
    return c.json(ok(invitation), 201);
  })
  .delete('/v1/workspace/invitations/:invitation_id', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    await authorize_team_administration(db, { workspace_id, user_id: c.get('user_id') });
    await revoke_team_invitation({
      organization_id: await read_team_organization_id(db, workspace_id),
      invitation_id: c.req.param('invitation_id'),
    });
    return c.json(ok({ invitation_id: c.req.param('invitation_id') }));
  })
  .get('/v1/workspace/slack-people', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    await authorize_team_administration(db, { workspace_id, user_id: c.get('user_id') });
    return c.json(ok(await list_workspace_slack_people(db, workspace_id)));
  })
  .patch('/v1/workspace', validate_json(rename_schema), async (c) => {
    const [db, workspace_id, actor_id] = [c.get('db'), c.get('workspace_id'), c.get('user_id')];
    await authorize_team_administration(db, { workspace_id, user_id: actor_id });
    const { workspace_name } = c.req.valid('json');
    const workspace = await rename_workspace(db, { workspace_id, workspace_name, actor_id });
    if (!workspace) throw new NotFoundError('Workspace');
    return c.json(ok(workspace));
  });

async function read_team_organization_id(
  db: Parameters<typeof find_workspace_organization_id>[0],
  workspace_id: string,
) {
  const organization_id = await find_workspace_organization_id(db, workspace_id);
  if (!organization_id) throw workos_environment_required();
  return organization_id;
}

async function reject_invitation_above_plan_limit(
  db: DatabaseExecutor,
  workspace_id: string,
  organization_id: string,
) {
  const plan = await find_workspace_plan(db, workspace_id);
  if (plan?.workspace_user_limit === undefined || plan.workspace_user_limit === null) return;

  const [active_members, invitations] = await Promise.all([
    count_active_workspace_members(db, workspace_id),
    list_team_invitations(organization_id),
  ]);
  if (active_members + invitations.length < plan.workspace_user_limit) return;

  throw new AppError(
    'workspace_user_limit_reached',
    `This workspace plan supports at most ${plan.workspace_user_limit} users and pending invitations.`,
    409,
  );
}
