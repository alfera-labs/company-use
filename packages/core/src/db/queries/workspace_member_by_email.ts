import type { Database } from '@coworker/core/db/connection';
import { is_the_match_email_in_team_mode } from '@coworker/core/db/queries/team_match_emails';
import { users, workspace_members } from '@coworker/core/db/schema';
import { and, eq, or } from 'drizzle-orm';

export async function find_active_workspace_member_by_email(
  db: Database,
  input: { workspace_id: string; email: string },
) {
  const [member] = await db
    .select({ user_id: workspace_members.user_id })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, input.workspace_id),
        eq(workspace_members.member_status, 'active'),
        or(
          eq(users.email, input.email.trim().toLowerCase()),
          is_the_match_email_in_team_mode(input.email),
        ),
      ),
    )
    .limit(1);

  return member?.user_id ?? null;
}
