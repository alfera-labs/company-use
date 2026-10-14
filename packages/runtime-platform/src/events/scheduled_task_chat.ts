import type { Database } from '@coworker/core';
import { open_trigger_chat_in_room_of_maker } from '@runtime-platform/events/trigger_chat_in_room_of_maker';

const scheduled_task_actor = 'system:trigger';

type ScheduledTask = {
  workspace_id: string;
  agent_id: string;
  trigger_id: string;
  trigger_name: string;
  created_by: string;
};

/** The chat a scheduled task runs in: in team mode, in the own room of the person who made it. */
export function open_scheduled_task_chat(
  db: Database,
  task: ScheduledTask,
  source_metadata: Record<string, unknown>,
) {
  return open_trigger_chat_in_room_of_maker(db, {
    workspace_id: task.workspace_id,
    agent_id: task.agent_id,
    external_thread_key: `trigger:${task.trigger_id}`,
    session_title: task.trigger_name,
    source_metadata,
    actor_id: scheduled_task_actor,
    maker_id: task.created_by,
  });
}
