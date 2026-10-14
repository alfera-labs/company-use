import type { Database } from '@coworker/core/db/connection';
import {
  type OnboardingCompanyScan,
  onboarding_company_scan_schema,
} from '@coworker/core/db/queries/onboarding_company_scan';
import { agents, users, workspaces } from '@coworker/core/db/schema';
import type { WorkspaceData } from '@coworker/core/db/schema/json_column_types';
import { NotFoundError } from '@coworker/shared';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';

const onboarding_workspace_key = 'onboarding';
const onboarding_profile_key = 'onboarding_profile';

export type OnboardingProfile = {
  how_found_us?: string | undefined;
  role?: string | undefined;
  work_kind?: string | undefined;
  marketing_opt_in?: boolean | undefined;
  saved_at?: string | undefined;
};

export type OnboardingRecord = {
  completed: boolean;
  step: string | null;
  channels_joined: number;
  welcome_sent: boolean;
  profile: OnboardingProfile | null;
  company_scan: OnboardingCompanyScan | null;
};

export type OnboardingIdentity = {
  workspace_name: string | null;
  agent_name: string | null;
};

export async function get_onboarding_record(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<OnboardingRecord> {
  const [workspace, user] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(workspaces.workspace_id, input.workspace_id) }),
    db.query.users.findFirst({ where: eq(users.user_id, input.user_id) }),
  ]);

  const onboarding = workspace?.workspace_data.onboarding;
  const profile = user?.user_data.onboarding_profile;

  return {
    completed: Boolean(onboarding?.completed_at),
    step: onboarding?.step ?? null,
    channels_joined: onboarding?.channels_joined ?? 0,
    welcome_sent: onboarding?.welcome_sent === true,
    profile: profile ?? null,
    company_scan: onboarding?.company_scan ?? null,
  };
}

export function read_workspace_onboarding_completed(workspace_data: WorkspaceData): boolean {
  return Boolean(workspace_data.onboarding?.completed_at);
}

export function read_workspace_onboarding_company_scan(
  workspace_data: WorkspaceData,
): OnboardingCompanyScan | null {
  return workspace_data.onboarding?.company_scan ?? null;
}

export async function get_onboarding_identity(
  db: Database,
  workspace_id: string,
): Promise<OnboardingIdentity> {
  const [workspace, agent] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(workspaces.workspace_id, workspace_id) }),
    db.query.agents.findFirst({
      where: and(eq(agents.workspace_id, workspace_id), eq(agents.agent_slug, 'main')),
      orderBy: [asc(agents.created_time)],
    }),
  ]);

  return {
    workspace_name: workspace?.workspace_name ?? null,
    agent_name: agent?.agent_name ?? null,
  };
}

export async function save_onboarding_profile(
  db: Database,
  input: { user_id: string; actor_id: string; profile: OnboardingProfile },
): Promise<OnboardingProfile> {
  const next_profile: OnboardingProfile = { ...input.profile, saved_at: now_iso() };
  const rows = await db
    .update(users)
    .set({
      user_data: sql`${users.user_data} || jsonb_build_object(${onboarding_profile_key}::text, ${JSON.stringify(next_profile)}::jsonb)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(users.user_id, input.user_id))
    .returning({ user_id: users.user_id });

  if (!rows[0]) throw new NotFoundError('User');
  return next_profile;
}

export async function set_onboarding_step(
  db: Database,
  input: { workspace_id: string; actor_id: string; step: string },
): Promise<OnboardingRecord> {
  return merge_workspace_onboarding(db, input, { step: input.step });
}

export async function save_onboarding_company_scan(
  db: Database,
  input: { workspace_id: string; actor_id: string; scan: OnboardingCompanyScan },
): Promise<OnboardingRecord> {
  return merge_workspace_onboarding(db, input, { company_scan: input.scan });
}

export async function complete_onboarding(
  db: Database,
  input: { workspace_id: string; actor_id: string },
): Promise<OnboardingRecord & { first_completion: boolean }> {
  const claimed = await merge_workspace_onboarding_when(
    db,
    input,
    { step: 'done', completed_at: now_iso() },
    sql`${workspaces.workspace_data} #>> '{onboarding,completed_at}' IS NULL`,
  );
  if (claimed) return { ...claimed, first_completion: true };

  const record = await get_onboarding_record(db, {
    workspace_id: input.workspace_id,
    user_id: input.actor_id,
  });
  return { ...record, first_completion: false };
}

export async function record_onboarding_channels_joined(
  db: Database,
  input: { workspace_id: string; actor_id: string; count: number },
): Promise<OnboardingRecord> {
  return merge_workspace_onboarding(db, input, { channels_joined: Math.max(0, input.count) });
}

export async function claim_onboarding_welcome(
  db: Database,
  input: { workspace_id: string; actor_id: string },
): Promise<boolean> {
  const claimed = await merge_workspace_onboarding_when(
    db,
    input,
    { welcome_sent: true, welcome_sent_at: now_iso() },
    sql`coalesce(${workspaces.workspace_data} #>> '{onboarding,welcome_sent}', 'false') <> 'true'`,
  );
  return claimed !== null;
}

async function merge_workspace_onboarding(
  db: Database,
  input: { workspace_id: string; actor_id: string },
  patch: Record<string, unknown>,
): Promise<OnboardingRecord> {
  const record = await merge_workspace_onboarding_when(db, input, patch);
  if (!record) throw new NotFoundError('Workspace');
  return record;
}

async function merge_workspace_onboarding_when(
  db: Database,
  input: { workspace_id: string; actor_id: string },
  patch: Record<string, unknown>,
  condition?: SQL,
): Promise<OnboardingRecord | null> {
  const rows = await db
    .update(workspaces)
    .set({
      workspace_data: sql`${workspaces.workspace_data} || jsonb_build_object(${onboarding_workspace_key}::text, coalesce(${workspaces.workspace_data} -> ${onboarding_workspace_key}::text, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(workspaces.workspace_id, input.workspace_id), ...(condition ? [condition] : [])))
    .returning({ workspace_data: workspaces.workspace_data });

  const updated = rows[0];
  if (!updated) return null;

  const onboarding = updated.workspace_data.onboarding;
  return {
    completed: Boolean(onboarding?.completed_at),
    step: onboarding?.step ?? null,
    channels_joined: onboarding?.channels_joined ?? 0,
    welcome_sent: onboarding?.welcome_sent === true,
    profile: null,
    company_scan: onboarding?.company_scan ?? null,
  };
}

function now_iso() {
  return new Date().toISOString();
}

export { type OnboardingCompanyScan, onboarding_company_scan_schema };
