import type { Database } from '@coworker/core/db/connection';
import { workspaces } from '@coworker/core/db/schema';
import { AppError } from '@coworker/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

export async function find_workspace_inbound_email_username(db: Database, workspace_id: string) {
  const [row] = await db
    .select({ inbound_email_username: workspaces.inbound_email_username })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, workspace_id))
    .limit(1);
  return row?.inbound_email_username ?? null;
}

// The retired-address arm is a jsonb containment scan of `workspaces`, one small table
// read per inbound mail. Add a GIN index on (workspace_data -> 'inbound_email' ->
// 'retired_usernames') if the workspace count ever makes that scan show up.
export async function list_active_workspaces_by_inbound_email_usernames(
  db: Database,
  usernames: string[],
) {
  if (usernames.length === 0) return [];
  const lowercased = usernames.map((username) => username.toLowerCase());
  const matches_retired = lowercased.map(
    (username) =>
      sql`${workspaces.workspace_data} -> 'inbound_email' -> 'retired_usernames' @> ${JSON.stringify([username])}::jsonb`,
  );
  const rows = await db
    .select({
      workspace_id: workspaces.workspace_id,
      workspace_name: workspaces.workspace_name,
      inbound_email_username: workspaces.inbound_email_username,
      workspace_data: workspaces.workspace_data,
    })
    .from(workspaces)
    .where(
      and(
        or(inArray(workspaces.inbound_email_username, lowercased), ...matches_retired),
        eq(workspaces.workspace_status, 'active'),
      ),
    );
  return rows.map(({ workspace_data, ...row }) => ({
    ...row,
    answers_to_usernames: [
      ...(row.inbound_email_username ? [row.inbound_email_username] : []),
      ...(workspace_data.inbound_email?.retired_usernames ?? []),
    ],
  }));
}

export async function claim_workspace_inbound_email_username(
  db: Database,
  input: { workspace_id: string; username: string; actor_id: string },
) {
  const username = input.username.toLowerCase();
  const existing = await find_workspace_inbound_email_username(db, input.workspace_id);
  if (existing) {
    if (existing === username) return existing;
    throw new AppError(
      'email_username_already_set',
      `This workspace already has the email username "${existing}".`,
      409,
    );
  }

  const owner = await find_workspace_owning_inbound_email_username(db, username);
  if (owner && owner !== input.workspace_id) {
    throw new AppError(
      'email_username_taken',
      `The email username "${username}" is already taken by another workspace.`,
      409,
    );
  }

  try {
    const [row] = await db
      .update(workspaces)
      .set({
        inbound_email_username: username,
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(eq(workspaces.workspace_id, input.workspace_id))
      .returning({ inbound_email_username: workspaces.inbound_email_username });
    if (!row?.inbound_email_username) {
      throw new AppError('not_found', 'Workspace not found', 404);
    }
    return row.inbound_email_username;
  } catch (error) {
    if (is_unique_violation(error)) {
      throw new AppError(
        'email_username_taken',
        `The email username "${username}" is already taken by another workspace.`,
        409,
      );
    }
    throw error;
  }
}

export async function rename_workspace_inbound_email_username(
  db: Database,
  input: { workspace_id: string; username: string; actor_id: string },
) {
  const username = input.username.toLowerCase();
  const [row] = await db
    .select({
      inbound_email_username: workspaces.inbound_email_username,
      workspace_data: workspaces.workspace_data,
    })
    .from(workspaces)
    .where(eq(workspaces.workspace_id, input.workspace_id))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Workspace not found', 404);
  const current = row.inbound_email_username;
  if (!current) {
    throw new AppError(
      'email_username_not_set',
      'This workspace has no email address to rename yet.',
      409,
    );
  }
  if (current === username) return current;

  const owner = await find_workspace_owning_inbound_email_username(db, username);
  if (owner && owner !== input.workspace_id) {
    throw new AppError(
      'email_username_taken',
      `The email username "${username}" is already taken by another workspace.`,
      409,
    );
  }

  const retired = [
    ...new Set([...(row.workspace_data.inbound_email?.retired_usernames ?? []), current]),
  ].filter((retired_username) => retired_username !== username);

  try {
    await db
      .update(workspaces)
      .set({
        inbound_email_username: username,
        workspace_data: sql`coalesce(${workspaces.workspace_data}, '{}'::jsonb) || jsonb_build_object(
          'inbound_email',
          coalesce(${workspaces.workspace_data} -> 'inbound_email', '{}'::jsonb) || ${JSON.stringify({ retired_usernames: retired })}::jsonb
        )`,
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(eq(workspaces.workspace_id, input.workspace_id));
    return username;
  } catch (error) {
    if (is_unique_violation(error)) {
      throw new AppError(
        'email_username_taken',
        `The email username "${username}" is already taken by another workspace.`,
        409,
      );
    }
    throw error;
  }
}

async function find_workspace_owning_inbound_email_username(db: Database, username: string) {
  const lowercased = username.toLowerCase();
  const [row] = await db
    .select({ workspace_id: workspaces.workspace_id })
    .from(workspaces)
    .where(
      and(
        or(
          eq(workspaces.inbound_email_username, lowercased),
          sql`${workspaces.workspace_data} -> 'inbound_email' -> 'retired_usernames' @> ${JSON.stringify([lowercased])}::jsonb`,
        ),
        eq(workspaces.workspace_status, 'active'),
      ),
    )
    .limit(1);
  return row?.workspace_id ?? null;
}

// The driver may wrap the Postgres error (drizzle raises its own error with the pg error as
// `cause`), so the unique-violation code is looked up along the cause chain.
function is_unique_violation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === '23505') return true;
  return is_unique_violation((error as { cause?: unknown }).cause);
}
