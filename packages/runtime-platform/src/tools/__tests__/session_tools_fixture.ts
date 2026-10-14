import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { create_project } from '@coworker/core/db/queries/projects';
import {
  archive_session,
  create_run,
  create_run_messages,
  create_session,
} from '@coworker/core/db/queries/sessions';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

export function tool_data(result: { success: boolean }) {
  expect(result).toMatchObject({ success: true });
  return (result as { success: true; data: Record<string, unknown> }).data;
}

export async function build_session_tools_workspace() {
  const db = await create_test_database();
  const identity = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_sessions_tools',
    organization_id: 'org_sessions_tools',
    email: 'sessions@example.com',
    first_name: 'Session',
    last_name: 'Reader',
  });
  const { workspace_id, agent_id, user_id } = identity;
  const other_user_id = 'user_someone_else';

  const chat = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Vendor quote',
    session_source: 'dashboard',
    actor_id: user_id,
  });
  const chat_run = await create_run(db, {
    workspace_id,
    session_id: chat.session_id,
    agent_id,
    trigger_type: 'user_message',
    actor_id: user_id,
  });
  await create_run_messages(db, [
    {
      workspace_id,
      session_id: chat.session_id,
      run_id: chat_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'The vendor sent the marble quote today.' },
      source_type: 'dashboard',
      actor_id: user_id,
    },
    {
      workspace_id,
      session_id: chat.session_id,
      run_id: chat_run.run_id,
      message_role: 'assistant',
      message_content: {
        type: 'multimodal',
        text: 'Sent it on.',
        parts: [
          { type: 'text', text: 'Sent it on.' },
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'slack-send_message-1',
            arguments: { channel: '#ops' },
          },
          {
            type: 'file',
            file_id: 'fil_quote',
            name: 'quote.pdf',
            mime_type: 'application/pdf',
          },
          { type: 'image', data: 'aGVsbG8=', mime_type: 'image/png' },
        ],
      },
      source_type: 'runtime',
      actor_id: user_id,
    },
    {
      workspace_id,
      session_id: chat.session_id,
      run_id: chat_run.run_id,
      message_role: 'system',
      message_content: { type: 'text', text: 'internal bookkeeping about marble' },
      source_type: 'runtime',
      is_user_visible: false,
      actor_id: user_id,
    },
  ]);

  const slack = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Standup',
    session_source: 'slack',
    actor_id: user_id,
  });

  const automation = await create_automation(db, {
    workspace_id,
    agent_id,
    automation_name: 'Watch the vendor thread',
    instruction: 'Watch the vendor thread and report.',
    actor_id: user_id,
  });
  const automation_session = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Vendor watcher',
    session_source: 'trigger',
    actor_id: user_id,
  });
  const automation_run = await create_run(db, {
    workspace_id,
    session_id: automation_session.session_id,
    agent_id,
    trigger_type: 'app_event',
    automation_id: automation.automation_id,
    actor_id: 'system:trigger',
  });
  await db
    .update(sessions)
    .set({ active_run_id: automation_run.run_id })
    .where(eq(sessions.session_id, automation_session.session_id));

  const private_project = await create_project(db, {
    workspace_id,
    project_name: 'Someone else',
    project_access: 'private',
    personal_for_user_id: other_user_id,
    owner_id: other_user_id,
    actor_id: other_user_id,
  });
  const private_session = await create_session(db, {
    workspace_id,
    agent_id,
    project_id: private_project.project_id,
    session_title: 'Their own marble thread',
    session_source: 'dashboard',
    actor_id: other_user_id,
  });
  const private_run = await create_run(db, {
    workspace_id,
    session_id: private_session.session_id,
    agent_id,
    trigger_type: 'user_message',
    actor_id: other_user_id,
  });
  await create_run_messages(db, [
    {
      workspace_id,
      session_id: private_session.session_id,
      run_id: private_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Our own marble supplier is cheaper.' },
      source_type: 'dashboard',
      actor_id: other_user_id,
    },
  ]);

  const deleted = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Old thread',
    session_source: 'dashboard',
    actor_id: user_id,
  });
  await archive_session(db, {
    workspace_id,
    session_id: deleted.session_id,
    actor_id: user_id,
  });

  return {
    db,
    workspace_id,
    agent_id,
    user_id,
    chat_session_id: chat.session_id,
    chat_run_id: chat_run.run_id,
    slack_session_id: slack.session_id,
    automation_id: automation.automation_id,
    automation_session_id: automation_session.session_id,
    automation_run_id: automation_run.run_id,
    private_session_id: private_session.session_id,
    private_run_id: private_run.run_id,
    deleted_session_id: deleted.session_id,
  };
}
