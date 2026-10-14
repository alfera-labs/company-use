import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { source_actors, users } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';

export type UpsertSourceActorInput = {
  workspace_id: string;
  provider: string;
  external_id: string;
  actor_kind?: string;
  display_name?: string | null;
  email?: string | null;
  actor_id: string;
};

export async function upsert_source_actor(db: Database, input: UpsertSourceActorInput) {
  const [row] = await db
    .insert(source_actors)
    .values({
      source_actor_id: create_id(id_prefixes.source_actor),
      workspace_id: input.workspace_id,
      actor_kind: input.actor_kind ?? 'platform_user',
      provider: input.provider,
      external_id: input.external_id,
      display_name: input.display_name ?? null,
      email: input.email ?? null,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: [source_actors.workspace_id, source_actors.provider, source_actors.external_id],
      targetWhere: sql`${source_actors.provider} is not null and ${source_actors.external_id} is not null`,
      set: {
        display_name: input.display_name ?? sql`${source_actors.display_name}`,
        email: input.email ?? sql`${source_actors.email}`,
        last_updated_by: input.actor_id,
        last_updated_time: new Date(),
      },
    })
    .returning();
  return require_inserted_row(row, 'Source actor');
}

export async function resolve_user_id_for_source_actor(
  db: Database,
  input: { workspace_id: string; source_actor_id: string },
): Promise<string | undefined> {
  const [row] = await db
    .select({
      provider: source_actors.provider,
      external_id: source_actors.external_id,
      email_user_id: users.user_id,
    })
    .from(source_actors)
    .leftJoin(users, eq(users.email, source_actors.email))
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.source_actor_id, input.source_actor_id),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  if (row.provider === 'dashboard') return row.external_id ?? undefined;
  return row.email_user_id ?? undefined;
}

export type SourceActorRow = typeof source_actors.$inferSelect;

export async function get_source_actor(
  db: Database,
  input: { workspace_id: string; source_actor_id: string },
): Promise<SourceActorRow | undefined> {
  const [row] = await db
    .select()
    .from(source_actors)
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.source_actor_id, input.source_actor_id),
      ),
    )
    .limit(1);
  return row;
}

export type RequestMemberLinkInput = {
  workspace_id: string;
  source_actor_id: string;
  candidate_user_id: string;
  actor_id: string;
};

/** Writes `member_link_state='pending_confirmation'` once. A row already past `unlinked` is left untouched. */
export async function request_source_actor_member_link(
  db: Database,
  input: RequestMemberLinkInput,
): Promise<SourceActorRow | undefined> {
  const [row] = await db
    .update(source_actors)
    .set({
      member_link_state: 'pending_confirmation',
      linked_user_id: input.candidate_user_id,
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.source_actor_id, input.source_actor_id),
        eq(source_actors.member_link_state, 'unlinked'),
      ),
    )
    .returning();
  return row;
}

export type ConfirmMemberLinkInput = {
  workspace_id: string;
  source_actor_id: string;
  actor_id: string;
};

/** Moves a `pending_confirmation` row to `linked`. A row not pending is left untouched. */
export async function confirm_source_actor_member_link(
  db: Database,
  input: ConfirmMemberLinkInput,
): Promise<SourceActorRow | undefined> {
  const [row] = await db
    .update(source_actors)
    .set({
      member_link_state: 'linked',
      last_updated_by: input.actor_id,
      last_updated_time: new Date(),
    })
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.source_actor_id, input.source_actor_id),
        eq(source_actors.member_link_state, 'pending_confirmation'),
      ),
    )
    .returning();
  return row;
}

export type MemberLinkCandidateRow = SourceActorRow & {
  candidate_email: string | null;
  candidate_first_name: string | null;
  candidate_last_name: string | null;
};

export async function list_member_link_candidates(
  db: Database,
  input: { workspace_id: string },
): Promise<MemberLinkCandidateRow[]> {
  const rows = await db
    .select({
      source_actor: source_actors,
      candidate_email: users.email,
      candidate_first_name: users.first_name,
      candidate_last_name: users.last_name,
    })
    .from(source_actors)
    .leftJoin(users, eq(users.user_id, source_actors.linked_user_id))
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        or(
          eq(source_actors.member_link_state, 'pending_confirmation'),
          eq(source_actors.member_link_state, 'linked'),
        ),
      ),
    )
    .orderBy(desc(source_actors.last_updated_time));
  return rows.map((row) => ({
    ...row.source_actor,
    candidate_email: row.candidate_email,
    candidate_first_name: row.candidate_first_name,
    candidate_last_name: row.candidate_last_name,
  }));
}
