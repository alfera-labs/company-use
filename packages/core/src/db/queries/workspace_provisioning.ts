import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { read_workspace_api_access_requested_time } from '@coworker/core/db/queries/api_access';
import { build_default_agent_values } from '@coworker/core/db/queries/default_agent_values';
import {
  type OnboardingCompanyScan,
  read_workspace_onboarding_company_scan,
  read_workspace_onboarding_completed,
} from '@coworker/core/db/queries/onboarding';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import {
  external_identity_target,
  fallback_email,
  is_fallback_email,
  membership_identity_id,
  normalize_email,
  normalize_workspace_identity,
  slug_from_parts,
  system_actor_for_identity,
  user_name,
  type WorkspaceIdentity,
  workspace_identity_id,
  workspace_name,
} from '@coworker/core/db/queries/workspace_identity';
import { open_workspace_project } from '@coworker/core/db/queries/workspace_projects';
import { agents, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { grant_welcome_credit } from '@coworker/core/services/billing';
import {
  count_active_workspace_members,
  find_workspace_plan,
} from '@coworker/core/services/workspace_plan';
import { AppError, create_id, id_prefixes } from '@coworker/shared';
import { and, eq, ne, or, sql } from 'drizzle-orm';

export type ProvisionedWorkspace = {
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workspace_was_created: boolean;
  user_was_created: boolean;
};

export type WorkspaceProfile = {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  onboarding_completed: boolean;
  company_scan: OnboardingCompanyScan | null;
  api_access_requested_time: string | null;
};

export async function find_workspace_profile(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceProfile | null> {
  const [workspace] = await db
    .select({
      workspace_id: workspaces.workspace_id,
      workspace_name: workspaces.workspace_name,
      workspace_slug: workspaces.workspace_slug,
      workspace_data: workspaces.workspace_data,
    })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, workspace_id))
    .limit(1);

  if (!workspace) return null;

  const { workspace_data, ...profile } = workspace;
  return {
    ...profile,
    onboarding_completed: read_workspace_onboarding_completed(workspace_data),
    company_scan: read_workspace_onboarding_company_scan(workspace_data),
    api_access_requested_time: read_workspace_api_access_requested_time(workspace_data),
  };
}

export type WorkspaceExternalIdentity = {
  external_identity_provider: string | null;
  external_identity_id: string | null;
};

export async function find_workspace_external_identity(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceExternalIdentity | null> {
  const [row] = await db
    .select({
      external_identity_provider: workspaces.external_identity_provider,
      external_identity_id: workspaces.external_identity_id,
    })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, workspace_id))
    .limit(1);
  return row ?? null;
}

export async function rename_workspace(
  db: Database,
  input: { workspace_id: string; workspace_name: string; actor_id: string },
): Promise<WorkspaceProfile | null> {
  await db
    .update(workspaces)
    .set({
      workspace_name: input.workspace_name,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(workspaces.workspace_id, input.workspace_id));

  return find_workspace_profile(db, input.workspace_id);
}

export type WorkspaceOwnerContact = {
  user_id: string;
  email: string;
  first_name: string | null;
  provider_user_id: string | null;
};

export async function find_workspace_owner_contact(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceOwnerContact | null> {
  const [row] = await db
    .select({
      user_id: users.user_id,
      email: users.email,
      first_name: users.first_name,
      provider_user_id: users.external_identity_id,
    })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_role, 'owner'),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .orderBy(workspace_members.created_time)
    .limit(1);
  return row?.email
    ? {
        user_id: row.user_id,
        email: row.email,
        first_name: row.first_name ?? null,
        provider_user_id: row.provider_user_id ?? null,
      }
    : null;
}

export async function provision_workspace_for_identity(
  db: Database,
  input: WorkspaceIdentity,
): Promise<ProvisionedWorkspace> {
  const identity = normalize_workspace_identity(input);
  const user = await upsert_identity_user(db, identity);
  const workspace = await upsert_identity_workspace(db, identity, user.user_id);

  const [agent, member_was_created] = await Promise.all([
    upsert_main_agent(db, { workspace_id: workspace.workspace_id, actor_id: user.user_id }),
    upsert_identity_workspace_member(db, {
      ...identity,
      user_id: user.user_id,
      workspace_id: workspace.workspace_id,
    }),
  ]);

  await Promise.all([
    grant_welcome_credit(db, {
      workspace_id: workspace.workspace_id,
      user_id: user.user_id,
    }),
    ...(workspace.was_created
      ? [
          open_workspace_project(db, {
            workspace_id: workspace.workspace_id,
            user_id: user.user_id,
          }),
        ]
      : []),
    ...(member_was_created
      ? [
          open_personal_project(db, {
            workspace_id: workspace.workspace_id,
            user_id: user.user_id,
          }),
        ]
      : []),
  ]);

  return {
    user_id: user.user_id,
    workspace_id: workspace.workspace_id,
    agent_id: agent.agent_id,
    workspace_was_created: workspace.was_created,
    user_was_created: user.user_was_created,
  };
}

export async function find_or_provision_workspace_for_identity(
  db: Database,
  input: WorkspaceIdentity,
): Promise<ProvisionedWorkspace> {
  return (
    (await find_workspace_for_identity(db, input)) ?? provision_workspace_for_identity(db, input)
  );
}

export async function find_workspace_for_identity(
  db: Database,
  input: WorkspaceIdentity,
): Promise<ProvisionedWorkspace | null> {
  const identity = normalize_workspace_identity(input);
  const [actor] = await db
    .select({
      user_id: users.user_id,
      workspace_id: workspaces.workspace_id,
      agent_id: agents.agent_id,
    })
    .from(users)
    .innerJoin(
      workspaces,
      and(
        eq(workspaces.external_identity_provider, identity.provider_key),
        eq(workspaces.external_identity_id, workspace_identity_id(identity)),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .innerJoin(
      workspace_members,
      and(
        eq(workspace_members.workspace_id, workspaces.workspace_id),
        eq(workspace_members.user_id, users.user_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .innerJoin(
      agents,
      and(
        eq(agents.workspace_id, workspaces.workspace_id),
        eq(agents.agent_slug, 'main'),
        eq(agents.agent_status, 'active'),
      ),
    )
    .where(
      and(
        eq(users.external_identity_provider, identity.provider_key),
        eq(users.external_identity_id, identity.provider_user_id),
        eq(users.user_status, 'active'),
      ),
    )
    .limit(1);

  return actor ? { ...actor, workspace_was_created: false, user_was_created: false } : null;
}

// Postgres sets xmax to 0 on a row this statement inserted, and to non-zero on a row ON CONFLICT
// DO UPDATE touched instead. That is the only honest answer to "did this call create the row",
// because the pre-check above can miss a row the unique index still finds: the same email under a
// different identity, a suspended workspace, or a concurrent insert.
async function upsert_identity_user(db: Database, identity: WorkspaceIdentity) {
  const email = normalize_email(identity.email) ?? fallback_email(identity);
  const name = user_name(identity);
  const user_values = {
    email,
    first_name: name.first_name ?? null,
    last_name: name.last_name ?? null,
    avatar_url: identity.avatar_url ?? null,
    external_identity_provider: identity.provider_key,
    external_identity_id: identity.provider_user_id,
    user_status: 'active',
    user_data: identity.user_data ?? {},
    last_updated_time: new Date(),
    last_updated_by: system_actor_for_identity(identity),
  };

  const [existing_identity_user] = await db
    .update(users)
    .set(user_values)
    .where(
      and(
        eq(users.external_identity_provider, identity.provider_key),
        eq(users.external_identity_id, identity.provider_user_id),
      ),
    )
    .returning({ user_id: users.user_id });
  if (existing_identity_user) return { ...existing_identity_user, user_was_created: false };

  if (is_fallback_email(email)) {
    const [upserted_user] = await db
      .insert(users)
      .values({
        ...user_values,
        created_by: system_actor_for_identity(identity),
      })
      .onConflictDoUpdate({
        target: [users.external_identity_provider, users.external_identity_id],
        targetWhere: external_identity_target(users),
        set: user_values,
      })
      .returning({ user_id: users.user_id, was_inserted: sql<boolean>`(xmax = 0)` });
    const user = require_inserted_row(upserted_user, 'Provisioned user');
    return { user_id: user.user_id, user_was_created: user.was_inserted };
  }

  const [upserted_user] = await db
    .insert(users)
    .values({
      ...user_values,
      created_by: system_actor_for_identity(identity),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: user_values,
    })
    .returning({ user_id: users.user_id, was_inserted: sql<boolean>`(xmax = 0)` });
  const user = require_inserted_row(upserted_user, 'Provisioned user');
  return { user_id: user.user_id, user_was_created: user.was_inserted };
}

async function upsert_identity_workspace(
  db: Database,
  identity: WorkspaceIdentity,
  user_id: string,
) {
  const external_identity_id = workspace_identity_id(identity);
  const resolved_workspace_name = workspace_name(identity);
  const workspace_slug = slug_from_parts(identity.provider_key, external_identity_id);
  const workspace_data = identity.workspace_data ?? {};
  const workspace_insert_values = {
    workspace_slug,
    workspace_status: 'active',
    external_identity_provider: identity.provider_key,
    external_identity_id,
    workspace_data,
    last_updated_time: new Date(),
    last_updated_by: user_id,
  };
  const workspace_update_values = {
    workspace_slug,
    workspace_status: sql`case when ${workspaces.workspace_status} = 'suspended' then 'suspended' else 'active' end`,
    external_identity_provider: identity.provider_key,
    external_identity_id,
    workspace_data: sql`${workspaces.workspace_data} || ${JSON.stringify(workspace_data)}::jsonb`,
    last_updated_time: new Date(),
    last_updated_by: user_id,
  };

  const existing_organization_workspace = await find_active_workspace_by_external_identity(db, {
    provider_key: identity.provider_key,
    external_identity_id,
  });
  if (existing_organization_workspace) {
    return { ...existing_organization_workspace, was_created: false };
  }

  const [upserted_workspace] = await db
    .insert(workspaces)
    .values({
      ...workspace_insert_values,
      workspace_name: resolved_workspace_name,
      created_by: user_id,
    })
    .onConflictDoUpdate({
      target: [workspaces.external_identity_provider, workspaces.external_identity_id],
      targetWhere: external_identity_target(workspaces),
      set: workspace_update_values,
    })
    .returning({
      workspace_id: workspaces.workspace_id,
      was_inserted: sql<boolean>`(xmax = 0)`,
    });
  const workspace = require_inserted_row(upserted_workspace, 'Provisioned workspace');
  return { workspace_id: workspace.workspace_id, was_created: workspace.was_inserted };
}

async function find_active_workspace_by_external_identity(
  db: Database,
  input: { provider_key: string; external_identity_id: string },
) {
  const [workspace] = await db
    .select({ workspace_id: workspaces.workspace_id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.external_identity_provider, input.provider_key),
        eq(workspaces.external_identity_id, input.external_identity_id),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .limit(1);

  return workspace ?? null;
}

async function upsert_identity_workspace_member(
  db: Database,
  identity: WorkspaceIdentity & { user_id: string; workspace_id: string },
) {
  const membership_external_id = membership_identity_id(identity);

  // The WorkOS membership identity is globally unique, but workspace/user ids get regenerated
  // when a workspace or user is re-provisioned (e.g. after a reset), which orphans the previous
  // member row — it still holds this membership id under a now-defunct (workspace, user). Clear
  // any such stale row first, otherwise the upsert below trips the separate
  // idx_workspace_members_external_identity_unique index (its ON CONFLICT only covers
  // (workspace_id, user_id)) and provisioning 500s, blocking sign-in.
  // Delete the orphan and insert in one transaction so two concurrent provisions for this
  // identity serialize on the row instead of interleaving into the global membership unique index.
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select 1 from ${workspaces} where ${workspaces.workspace_id} = ${identity.workspace_id} for update`,
    );

    if (membership_external_id) {
      await tx
        .delete(workspace_members)
        .where(
          and(
            eq(workspace_members.external_identity_provider, identity.provider_key),
            eq(workspace_members.external_identity_id, membership_external_id),
            or(
              ne(workspace_members.workspace_id, identity.workspace_id),
              ne(workspace_members.user_id, identity.user_id),
            ),
          ),
        );
    }

    const [existing_member] = await tx
      .select({
        member_role: workspace_members.member_role,
        member_status: workspace_members.member_status,
      })
      .from(workspace_members)
      .where(
        and(
          eq(workspace_members.workspace_id, identity.workspace_id),
          eq(workspace_members.user_id, identity.user_id),
        ),
      )
      .limit(1);
    const next_member_status = identity.member_status ?? 'active';
    if (next_member_status === 'active' && existing_member?.member_status !== 'active') {
      await reject_workspace_member_above_plan_limit(tx, identity.workspace_id);
    }
    const member_role = await find_workspace_member_role(
      tx,
      identity,
      existing_member?.member_role,
    );

    await tx
      .insert(workspace_members)
      .values({
        workspace_member_id: create_id(id_prefixes.workspace_member),
        workspace_id: identity.workspace_id,
        user_id: identity.user_id,
        member_role,
        member_status: next_member_status,
        external_identity_provider: identity.provider_key,
        external_identity_id: membership_external_id,
        created_by: identity.user_id,
        last_updated_by: identity.user_id,
      })
      .onConflictDoUpdate({
        target: [workspace_members.workspace_id, workspace_members.user_id],
        set: {
          member_role,
          member_status: next_member_status,
          external_identity_provider: identity.provider_key,
          external_identity_id: membership_external_id,
          last_updated_time: new Date(),
          last_updated_by: identity.user_id,
        },
      });
    return existing_member === undefined;
  });
}

async function reject_workspace_member_above_plan_limit(
  db: DatabaseExecutor,
  workspace_id: string,
) {
  const plan = await find_workspace_plan(db, workspace_id);
  if (plan?.workspace_user_limit === undefined || plan.workspace_user_limit === null) return;

  if ((await count_active_workspace_members(db, workspace_id)) < plan.workspace_user_limit) return;

  throw new AppError(
    'workspace_user_limit_reached',
    `This workspace plan supports at most ${plan.workspace_user_limit} users.`,
    409,
  );
}

async function find_workspace_member_role(
  db: DatabaseExecutor,
  identity: WorkspaceIdentity & { user_id: string; workspace_id: string },
  existing_member_role?: string,
) {
  if (identity.member_role) return identity.member_role;
  if (existing_member_role) return existing_member_role;

  const [active_member] = await db
    .select({ workspace_member_id: workspace_members.workspace_member_id })
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, identity.workspace_id),
        eq(workspace_members.member_status, 'active'),
      ),
    )
    .limit(1);

  return active_member ? 'member' : 'owner';
}

async function upsert_main_agent(db: Database, input: { workspace_id: string; actor_id: string }) {
  const agent_values = build_default_agent_values();
  const [agent] = await db
    .insert(agents)
    .values({
      agent_id: create_id(id_prefixes.agent),
      workspace_id: input.workspace_id,
      ...agent_values,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: [agents.workspace_id, agents.agent_slug],
      set: {
        agent_status: 'active',
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      },
    })
    .returning({ agent_id: agents.agent_id });

  return require_inserted_row(agent, 'Provisioned agent');
}
