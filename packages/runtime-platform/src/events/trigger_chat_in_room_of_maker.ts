import type { Database } from '@coworker/core';
import { move_session_to_project } from '@coworker/core/db/queries/session_placement';
import { find_team_room_of_maker } from '@coworker/core/db/queries/team_room_of_maker';
import { find_or_create_trigger_session } from '@coworker/core/db/queries/trigger_sessions';

type TriggerChat = {
  workspace_id: string;
  agent_id: string;
  external_thread_key: string;
  session_title: string;
  source_metadata: Record<string, unknown>;
  actor_id: string;
  maker_id: string;
};

/**
 * The chat that work with no person in it runs in: a scheduled task, a run of an automation.
 * In team mode it goes in the own room of the person who made that work, so what the run finds
 * and writes is that person's to read, and nobody else's. A chat from before that rule is moved
 * there when it runs again. Outside team mode the chat is in no room, as before.
 */
export async function open_trigger_chat_in_room_of_maker(db: Database, input: TriggerChat) {
  const { maker_id, ...chat_input } = input;
  const room = await find_team_room_of_maker(db, { workspace_id: input.workspace_id, maker_id });
  const chat = await find_or_create_trigger_session(db, { ...chat_input, ...room });
  if (!room.project_id || chat.project_id) return chat;
  return move_session_to_project(db, {
    workspace_id: input.workspace_id,
    session_id: chat.session_id,
    project_id: room.project_id,
    actor_id: input.actor_id,
  });
}
