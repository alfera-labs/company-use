import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  list_run_events,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import { record_runtime_error_event } from '@runtime-platform/orchestrator/runtime_error_event';
import { describe, expect, it } from 'vitest';

async function create_failing_run() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Run that dies in the orchestrator',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: bootstrap.user_id,
  };
}

describe('a run that fails inside the orchestrator', () => {
  it('tells the user, and keeps the raw failure in the run event', async () => {
    const { db, workspace_id, session_id, run_id, actor_id } = await create_failing_run();
    const failure_text =
      '[23505] duplicate key value violates unique constraint "idx_run_events_run_sequence_unique"';

    await record_runtime_error_event(db, {
      workspace_id,
      session_id,
      run_id,
      message: failure_text,
      actor_id,
    });

    const events = await list_run_events(db, workspace_id, run_id);
    const error_events = events.filter((event) => event.event_type === 'error');
    expect(error_events).toHaveLength(1);
    expect(error_events[0]?.event_label).toBe(failure_text);

    const messages = await list_session_messages(db, workspace_id, session_id);
    const visible_assistant_messages = messages.filter(
      (message) => message.message_role === 'assistant' && message.is_user_visible,
    );
    expect(visible_assistant_messages).toHaveLength(1);
    expect(visible_assistant_messages[0]?.content_text).toBe(
      "Something went wrong and I couldn't finish. Please try again.",
    );
    expect(visible_assistant_messages[0]?.content_text).not.toContain('23505');
  });

  it('keeps the failure notice out of the model context, since it can land between a tool call and its results', async () => {
    const { db, workspace_id, session_id, run_id, actor_id } = await create_failing_run();

    await record_runtime_error_event(db, {
      workspace_id,
      session_id,
      run_id,
      message: 'timeout exceeded when trying to connect',
      actor_id,
    });

    const messages = await list_session_messages(db, workspace_id, session_id);
    const notice = messages.find((message) => message.message_role === 'assistant');
    expect(notice?.is_user_visible).toBe(true);
    expect(notice?.is_model_visible).toBe(false);
  });
});
