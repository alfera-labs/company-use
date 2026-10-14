import type { Database } from '@coworker/core/db/connection';
import { channels } from '@coworker/core/db/schema';
import { and, asc, eq } from 'drizzle-orm';

// Which project a channel route works in. A conversation that arrives through the route starts its
// chats in that project, so it reads the project's instructions and uses only what the project was
// given. Provider-blind: a Slack channel today, a group chat or an inbound address tomorrow.

export type ProjectChannel = {
  channel_route_id: string;
  channel_provider_key: string;
  channel_name: string | null;
  external_conversation_id: string | null;
  channel_status: string;
};

export async function list_project_channels(
  db: Database,
  input: { workspace_id: string; project_id: string },
): Promise<ProjectChannel[]> {
  return db
    .select({
      channel_route_id: channels.channel_id,
      channel_provider_key: channels.channel_provider_key,
      channel_name: channels.channel_name,
      external_conversation_id: channels.external_conversation_id,
      channel_status: channels.channel_status,
    })
    .from(channels)
    .where(
      and(eq(channels.workspace_id, input.workspace_id), eq(channels.project_id, input.project_id)),
    )
    .orderBy(asc(channels.channel_name));
}

// Null takes the route out of any project. Existing chats stay where they started: only a
// conversation that starts after this reads the new project.
export async function set_channel_project(
  db: Database,
  input: {
    workspace_id: string;
    channel_route_id: string;
    project_id: string | null;
    actor_id: string;
  },
) {
  const [channel] = await db
    .update(channels)
    .set({
      project_id: input.project_id,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(channels.workspace_id, input.workspace_id),
        eq(channels.channel_id, input.channel_route_id),
      ),
    )
    .returning();
  return channel ?? null;
}
