import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_session,
  list_session_messages,
  list_session_runs,
} from '@coworker/core/db/queries/sessions';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
  vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
});

const a_folder_that_cannot_be_made = '/dev/null/workspaces';

async function send_a_message_to_a_sandbox_that_cannot_start() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const failure = await start_agent_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    user_message: 'Count the lines of <report.md> for me',
    source_type: 'dashboard',
    user_message_source_metadata: { client_message_id: 'client:first-message' },
    actor_id: bootstrap.user_id,
    workspace_runtime_provider: 'local',
    workspace_base_path: a_folder_that_cannot_be_made,
  }).catch((error: unknown) => error);
  const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
  const runs = await list_session_runs(db, bootstrap.workspace_id, session.session_id);
  return { failure, messages, runs };
}

describe('a run whose sandbox cannot start, on a self-hosted install', () => {
  it("keeps the person's message, so it is still there after a reload", async () => {
    const { failure, messages } = await send_a_message_to_a_sandbox_that_cannot_start();

    expect(failure).toBeInstanceOf(Error);
    const user_messages = messages.filter((message) => message.message_role === 'user');
    expect(user_messages).toHaveLength(1);
    expect(user_messages[0]?.content_text).toBe('Count the lines of <report.md> for me');
    expect(user_messages[0]?.is_user_visible).toBe(true);
    expect(user_messages[0]?.source_metadata).toMatchObject({
      client_message_id: 'client:first-message',
    });
  });

  it('says why in one sentence, and names the command that finds the fix', async () => {
    const { messages } = await send_a_message_to_a_sandbox_that_cannot_start();

    const notice = messages.filter((message) => message.message_role === 'assistant');
    expect(notice).toHaveLength(1);
    expect(notice[0]?.content_text).toBe(
      'The sandbox could not start, so I did not run this. On the server, run ./alfera doctor to find the fix.',
    );
    expect(messages.map((message) => message.message_role)).toEqual(['user', 'assistant']);
  });

  it('ends the run as failed, so the chat stops working on it', async () => {
    const { runs } = await send_a_message_to_a_sandbox_that_cannot_start();

    expect(runs.map((run) => run.run_status)).toEqual(['failed']);
  });
});
