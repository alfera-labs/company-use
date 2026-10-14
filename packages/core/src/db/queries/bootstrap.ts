import { product_brand_config } from '@coworker/config';
import type { Database } from '@coworker/core/db/connection';
import {
  build_default_agent_values,
  build_default_model_values,
  has_previous_default_prompt,
  is_legacy_agent_name,
  uses_legacy_local_model,
} from '@coworker/core/db/queries/default_agent_values';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { open_workspace_project } from '@coworker/core/db/queries/workspace_projects';
import { agents, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export type BootstrapResult = {
  user_id: string;
  workspace_id: string;
  agent_id: string;
};

type WorkspaceAgentInput = {
  workspace_id: string;
  actor_id: string;
};

export async function bootstrap_default_workspace(db: Database): Promise<BootstrapResult> {
  const actor_id = 'system:bootstrap';
  const product_brand_name = product_brand_config.product_brand_name;
  const existing_workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.workspace_slug, 'default'),
  });
  const [upserted_user] = await db
    .insert(users)
    .values({
      email: 'founder@runtime.local',
      first_name: 'Founder',
      user_status: 'active',
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        last_updated_time: new Date(),
        last_updated_by: actor_id,
      },
    })
    .returning({ user_id: users.user_id });
  const user = require_inserted_row(upserted_user, 'User');

  const [upserted_workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: product_brand_name,
      workspace_slug: 'default',
      workspace_status: 'active',
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: workspaces.workspace_slug,
      set: {
        workspace_name: sql`CASE WHEN ${workspaces.workspace_name} = ${legacy_runtime_codename()} THEN ${product_brand_name} ELSE ${workspaces.workspace_name} END`,
        last_updated_time: new Date(),
        last_updated_by: actor_id,
      },
    })
    .returning({ workspace_id: workspaces.workspace_id });
  const workspace = require_inserted_row(upserted_workspace, 'Workspace');

  const inserted_members = await db
    .insert(workspace_members)
    .values({
      workspace_member_id: create_id(id_prefixes.workspace_member),
      workspace_id: workspace.workspace_id,
      user_id: user.user_id,
      member_role: 'owner',
      member_status: 'active',
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoNothing({
      target: [workspace_members.workspace_id, workspace_members.user_id],
    })
    .returning({ workspace_member_id: workspace_members.workspace_member_id });

  const active_agent = await upsert_default_agent_for_workspace(db, {
    workspace_id: workspace.workspace_id,
    actor_id,
  });

  await Promise.all([
    ...(existing_workspace
      ? []
      : [
          open_workspace_project(db, {
            workspace_id: workspace.workspace_id,
            user_id: user.user_id,
          }),
        ]),
    ...(inserted_members.length === 0
      ? []
      : [
          open_personal_project(db, {
            workspace_id: workspace.workspace_id,
            user_id: user.user_id,
          }),
        ]),
  ]);

  return {
    user_id: user.user_id,
    workspace_id: workspace.workspace_id,
    agent_id: active_agent.agent_id,
  };
}

export async function upsert_default_agent_for_workspace(db: Database, input: WorkspaceAgentInput) {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_status, 'active')),
  });
  const agent_id = agent?.agent_id ?? create_id(id_prefixes.agent);
  const default_agent_values = build_default_agent_values(agent?.agent_config);

  if (agent) {
    await db
      .update(agents)
      .set({
        ...(is_legacy_agent_name(agent.agent_name) ? default_agent_values : {}),
        ...(uses_legacy_local_model(agent) ? build_default_model_values(agent.agent_config) : {}),
        ...(has_previous_default_prompt(agent)
          ? { system_prompt: default_agent_values.system_prompt }
          : {}),
        ...(agent.agent_slug ? {} : { agent_slug: default_agent_values.agent_slug }),
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(eq(agents.agent_id, agent.agent_id));
  } else {
    await db
      .insert(agents)
      .values({
        agent_id,
        workspace_id: input.workspace_id,
        ...default_agent_values,
        created_by: input.actor_id,
        last_updated_by: input.actor_id,
      })
      .onConflictDoNothing({
        target: [agents.workspace_id, agents.agent_slug],
      });
  }

  const active_agent = await db.query.agents.findFirst({
    where: and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_status, 'active')),
  });
  if (!active_agent) throw new Error('Agent bootstrap did not return a row');

  return active_agent;
}

function legacy_runtime_codename() {
  return ['Runtime', 'Core'].join(' ');
}
