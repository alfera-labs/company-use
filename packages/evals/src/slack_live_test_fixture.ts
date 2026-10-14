import {
  create_run,
  create_run_message,
  create_session,
  create_tool_call_started,
  update_run_status,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import { connections } from '@coworker/core/db/schema';
import type { EvalTask } from '@coworker/evals/eval_types';
import type { SlackEvalSender } from '@coworker/evals/slack_eval_sender';
import { load_eval_tasks } from '@coworker/evals/task_source';

export function create_test_sender(after_post: (text: string) => Promise<void>): SlackEvalSender {
  return {
    get_user_id: async () => 'U_SENDER',
    post_message: async ({ text }) => after_post(text),
  };
}

export async function insert_slack_test_connection(
  db: Parameters<typeof create_session>[0],
  bootstrap: { workspace_id: string; user_id: string },
) {
  await db.insert(connections).values({
    connection_id: 'conn_eval_slack',
    workspace_id: bootstrap.workspace_id,
    app_id: 'app_eval_slack',
    connection_key: 'native:slack:eval',
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    connection_profile_key: 'native:slack_workspace_bot',
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_EVALS',
    authorized_scopes: ['chat:write'],
    provider_account: { bot_user_id: 'U_ALFERA', authed_user: { id: 'U_SENDER' } },
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
}

export async function load_slack_test_task(task_id: string) {
  const task = (await load_eval_tasks('slack_operator')).find((item) => item.task_id === task_id);
  if (!task) throw new Error(`Missing eval task fixture: ${task_id}`);
  return task;
}

export async function create_completed_slack_test_run(
  db: Parameters<typeof create_session>[0],
  bootstrap: { workspace_id: string; agent_id: string; user_id: string },
  task: EvalTask,
) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Live Slack eval',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await create_run_message(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'user',
    message_content: { type: 'text', text: task.prompt },
    source_type: 'slack',
    source_metadata: {
      source_actor: { profile: { email: 'fixtures@example.com' } },
      slack: { channel_id: 'CEVALS123' },
    },
    actor_id: bootstrap.user_id,
  });
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: bootstrap.agent_id,
    tool_name: 'slack-respond-1',
    tool_input: { message: 'Created the launch map.', resolution_type: 'reply' },
    actor_id: bootstrap.user_id,
  });
  await update_tool_call_finished(db, {
    tool_call_id: tool_call.tool_call_id,
    tool_status: 'completed',
    output: { ok: true },
    duration_ms: 10,
    actor_id: bootstrap.user_id,
  });
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: bootstrap.user_id,
  });
}
