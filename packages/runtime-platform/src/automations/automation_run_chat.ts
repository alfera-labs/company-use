import type { Database } from '@coworker/core';
import { open_trigger_chat_in_room_of_maker } from '@runtime-platform/events/trigger_chat_in_room_of_maker';

type AutomationOfTheRun = {
  workspace_id: string;
  agent_id: string;
  automation_name: string;
  created_by: string;
};

type RunChat = {
  session_key: string;
  source_metadata: Record<string, unknown>;
  actor_id: string;
};

/** The chat a run of an automation is in: in team mode, in the own room of who made the automation. */
export function open_automation_run_chat(
  db: Database,
  automation: AutomationOfTheRun,
  chat: RunChat,
) {
  return open_trigger_chat_in_room_of_maker(db, {
    workspace_id: automation.workspace_id,
    agent_id: automation.agent_id,
    external_thread_key: chat.session_key,
    session_title: automation.automation_name,
    source_metadata: chat.source_metadata,
    actor_id: chat.actor_id,
    maker_id: automation.created_by,
  });
}
