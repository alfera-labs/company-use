import type { Database } from '@coworker/core';
import {
  type CreateRunMessageInput,
  create_run_messages,
} from '@coworker/core/db/queries/sessions';
import { record_runtime_failure_message } from '@runtime-platform/orchestrator/event_persistence';
import { run_failure_sentence_on_this_install } from '@runtime-platform/orchestrator/run_failure_sentence';
import { create_stored_run_event } from '@runtime-platform/orchestrator/stored_run_event_payloads';

/**
 * Records a run that failed inside the orchestrator: the raw cause as a run event, and one
 * sentence in the chat. A run that failed before its input messages were saved passes them
 * here, so the person's message is saved first and is still there after a reload.
 */
export async function record_runtime_error_event(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    message: string;
    sandbox_started?: boolean;
    unsaved_input_messages?: CreateRunMessageInput[];
    is_user_visible?: boolean;
    actor_id: string;
  },
) {
  const event = await create_stored_run_event(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    event_type: 'error',
    event_label: input.message,
    event_data: {
      event_type: 'error',
      message: input.message,
      source: 'runtime_orchestrator',
    },
    actor_id: input.actor_id,
  });

  await create_run_messages(db, input.unsaved_input_messages ?? []);
  await record_runtime_failure_message(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    text: run_failure_sentence_on_this_install(input),
    ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
    actor_id: input.actor_id,
  });

  return event;
}
