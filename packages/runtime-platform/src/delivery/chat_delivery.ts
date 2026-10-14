import type { Database } from '@coworker/core';
import { find_live_chat_session } from '@coworker/core/db/queries/live_chat_session';
import {
  create_run,
  create_run_message,
  update_run_status,
} from '@coworker/core/db/queries/sessions';

export async function deliver_by_chat(
  db: Database,
  input: {
    workspace_id: string;
    principal_id: string | null;
    text: string;
    now?: Date | undefined;
  },
): Promise<string | null> {
  if (!input.principal_id) return null;
  const session = await find_live_chat_session(db, {
    workspace_id: input.workspace_id,
    user_id: input.principal_id,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!session) return null;

  const actor_id = input.principal_id;
  const run = await create_run(db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    agent_id: session.agent_id,
    trigger_type: 'api',
    run_metadata: { source: 'notification_delivery' },
    actor_id,
  });
  await update_run_status(db, { run_id: run.run_id, run_status: 'completed', actor_id });
  const message = await create_run_message(db, {
    workspace_id: input.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'assistant',
    message_content: { type: 'text', text: input.text },
    source_type: 'runtime',
    source_metadata: { notification_delivery: true },
    is_user_visible: true,
    is_model_visible: true,
    actor_id,
  });
  return `${session.session_id}:${message.run_message_id}`;
}
