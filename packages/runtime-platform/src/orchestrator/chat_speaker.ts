import type { Database } from '@coworker/core';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import { get_user, user_display_name } from '@coworker/core/db/queries/users';
import { get_source_actor_identity } from '@runtime-platform/orchestrator/current_turn_context';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

export async function resolve_chat_speaker(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    source_metadata?: RuntimeToolSourceMetadata | undefined;
    read_actor_user?: Awaited<ReturnType<typeof get_user>> | null;
  },
): Promise<{ source_actor_id: string; name: string; email?: string } | undefined> {
  try {
    const sender = get_source_actor_identity(input.source_metadata);
    if (sender?.user_id && sender.name) {
      const actor = await upsert_source_actor(db, {
        workspace_id: input.workspace_id,
        provider: 'slack',
        external_id: sender.user_id,
        display_name: sender.name,
        ...(sender.email ? { email: sender.email } : {}),
        actor_id: input.actor_id,
      });
      return {
        source_actor_id: actor.source_actor_id,
        name: sender.name,
        ...(sender.email ? { email: sender.email } : {}),
      };
    }

    const user =
      input.read_actor_user === undefined
        ? await get_user(db, input.actor_id)
        : input.read_actor_user;
    if (!user) return undefined;
    const name = user_display_name(user);
    const actor = await upsert_source_actor(db, {
      workspace_id: input.workspace_id,
      provider: 'dashboard',
      external_id: input.actor_id,
      display_name: name,
      email: user.email,
      actor_id: input.actor_id,
    });
    return {
      source_actor_id: actor.source_actor_id,
      name,
      ...(user.email ? { email: user.email } : {}),
    };
  } catch {
    return undefined;
  }
}
