import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_live_chat_session } from '@coworker/core/db/queries/live_chat_session';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('find_live_chat_session', () => {
  it('finds the web chat a person typed in even after its turn completed', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      session_source: 'dashboard',
      source_type: 'dashboard',
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
      message_content: { type: 'text', text: 'hello' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(sessions)
      .set({ session_status: 'completed' })
      .where(eq(sessions.session_id, session.session_id));

    const found = await find_live_chat_session(db, {
      workspace_id: bootstrap.workspace_id,
      user_id: bootstrap.user_id,
    });
    expect(found?.session_id).toBe(session.session_id);

    await db
      .update(sessions)
      .set({ session_status: 'deleted' })
      .where(eq(sessions.session_id, session.session_id));
    expect(await find_live_chat_session(db, { workspace_id: bootstrap.workspace_id })).toBeNull();
  });
});
