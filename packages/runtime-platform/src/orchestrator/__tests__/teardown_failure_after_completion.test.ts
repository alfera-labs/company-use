import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_session,
  get_run,
  get_session,
  list_run_events,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { wait_for_all_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/teardown-failure-test',
    async *run() {
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'the real answer' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({
    provider: 'openai',
    model_name: 'gpt-test',
    reasoning_level: 'medium',
  }),
}));

const workspace_close = vi.hoisted(() => ({
  run: async (): Promise<unknown> => {
    throw new Error(
      'Persistent workspace teardown failed: Archil unmount of /mnt/coworker failed after 3 attempts: [deadline_exceeded] the operation timed out',
    );
  },
}));

vi.mock('@runtime-platform/orchestrator/workspace_runtime', async (import_original) => {
  const actual = await import_original<object>();
  return { ...actual, mark_coding_workspace_idle: () => workspace_close.run() };
});

describe('a workspace teardown failure after the run completed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the run and session completed and never speaks to the user', async () => {
    const teardown_warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    const completed_run = await start_agent_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      user_message: 'finish this',
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
      workspace_runtime_provider: 'local',
    });
    await wait_for_all_workspace_close_work();

    const persisted_run = await get_run(db, bootstrap.workspace_id, completed_run.run_id);
    const persisted_session = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(completed_run.run_status).toBe('completed');
    expect(persisted_run?.run_status).toBe('completed');
    expect(persisted_session?.session_status).toBe('completed');

    const events = await list_run_events(db, bootstrap.workspace_id, completed_run.run_id);
    expect(events.filter((event) => event.event_type === 'error')).toHaveLength(0);

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const visible_texts = messages
      .filter((message) => message.message_role === 'assistant' && message.is_user_visible)
      .map((message) => message.content_text);
    expect(visible_texts).toContain('the real answer');
    expect(visible_texts).not.toContain(
      "Something went wrong and I couldn't finish. Please try again.",
    );

    expect(teardown_warning).toHaveBeenCalledWith(
      expect.stringContaining('Workspace teardown failed after the run already finished.'),
    );
  });
});

describe('the workspace close after a completed run', () => {
  it('runs after the session lock is released', async () => {
    let finish_close: (() => void) | undefined;
    workspace_close.run = () =>
      new Promise((resolve) => {
        finish_close = () => resolve(undefined);
      });
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    const completed_run = await start_agent_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      user_message: 'finish this',
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
      workspace_runtime_provider: 'local',
    });

    expect(completed_run.run_status).toBe('completed');
    await vi.waitFor(() => expect(finish_close).toBeDefined());
    const session_during_close = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(session_during_close?.locked_by_run_id).toBeNull();

    finish_close?.();
    await wait_for_all_workspace_close_work();
  });
});
