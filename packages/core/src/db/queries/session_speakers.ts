import type { Database } from '@coworker/core/db/connection';
import { upsert_session_source_actor } from '@coworker/core/db/queries/sessions';
import { get_user, user_display_name } from '@coworker/core/db/queries/users';
import type { sessions, users } from '@coworker/core/db/schema';
import { create_platform_source_actor, type SourceActor } from '@coworker/shared';

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

export async function record_platform_user_as_speaker(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    user_id: string;
    observed_time?: Date;
  },
): Promise<SourceActor> {
  const user = await get_user(db, input.user_id);
  return (await record_known_user_as_speaker(db, { ...input, user })).source_actor;
}

export async function record_known_user_as_speaker(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    user_id: string;
    user: UserRow | undefined;
    read_session?: SessionRow;
    observed_time?: Date;
  },
): Promise<{ source_actor: SourceActor; session: SessionRow }> {
  const source_actor = create_platform_source_actor({
    platform_user_id: input.user_id,
    profile: input.user
      ? { display_name: user_display_name(input.user), email: input.user.email }
      : {},
  });
  const session = await upsert_session_source_actor(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    source_actor,
    ...(input.observed_time === undefined ? {} : { observed_time: input.observed_time }),
    ...(input.read_session ? { read_session: input.read_session } : {}),
    actor_id: input.user_id,
  });
  return { source_actor, session };
}
