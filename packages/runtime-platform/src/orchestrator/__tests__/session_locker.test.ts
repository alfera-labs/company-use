import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { sessions } from '@coworker/core/db/schema';
import { acquire_session_lock } from '@runtime-platform/orchestrator/session_locker';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function create_locked_session_scaffold() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: 'test',
  });
  return { db, workspace_id: bootstrap.workspace_id, session_id: session.session_id };
}

describe('acquire_session_lock renewal', () => {
  afterEach(() => vi.useRealTimers());

  it('calls on_lock_lost when a renewal finds the session lock is no longer ours', async () => {
    const { db, workspace_id, session_id } = await create_locked_session_scaffold();

    vi.useFakeTimers();
    const on_lock_lost = vi.fn();
    await acquire_session_lock(db, {
      workspace_id,
      session_id,
      run_id: 'run_owner',
      actor_id: 'test',
      on_lock_lost,
    });

    await db
      .update(sessions)
      .set({ locked_by_run_id: 'run_thief' })
      .where(eq(sessions.session_id, session_id));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(on_lock_lost).toHaveBeenCalledOnce();
  });

  it('does not call on_lock_lost while renewals keep succeeding', async () => {
    const { db, workspace_id, session_id } = await create_locked_session_scaffold();

    vi.useFakeTimers();
    const on_lock_lost = vi.fn();
    await acquire_session_lock(db, {
      workspace_id,
      session_id,
      run_id: 'run_owner',
      actor_id: 'test',
      on_lock_lost,
    });

    await vi.advanceTimersByTimeAsync(90_000);

    expect(on_lock_lost).not.toHaveBeenCalled();
  });
});
