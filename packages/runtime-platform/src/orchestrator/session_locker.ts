import type { Database } from '@coworker/core';
import {
  acquire_session_execution_lock,
  recover_stale_running_runs,
  release_session_execution_lock,
  renew_session_execution_lock,
} from '@coworker/core/db/queries/sessions';
import { ConflictError } from '@coworker/shared';

const session_lock_ttl_ms = 90 * 1000;
const session_lock_renewal_interval_ms = 30 * 1000;

export type SessionLock = {
  run_id: string;
  renew(): Promise<boolean>;
  release(session_status?: 'active' | 'idle' | 'failed' | 'cancelled' | 'completed'): Promise<void>;
  stop_renewing(): void;
};

type SessionLockInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  actor_id: string;
};

export async function acquire_session_lock(
  db: Database,
  input: SessionLockInput & { on_lock_lost?: () => void },
): Promise<SessionLock> {
  const { on_lock_lost, ...lock_input } = input;
  const [, session] = await Promise.all([
    recover_stale_running_runs(db, {
      workspace_id: lock_input.workspace_id,
      actor_id: lock_input.actor_id,
      limit: 1,
      recover_orphan_runs: false,
    }),
    acquire_session_execution_lock(db, { ...lock_input, lease_ms: session_lock_ttl_ms }),
  ]);

  if (!session) throw_session_lock_conflict(lock_input.session_id);

  let renewal_timer: ReturnType<typeof setInterval> | undefined;
  const renew = () => renew_session_lock(db, lock_input);
  const stop_renewing = () => {
    if (renewal_timer) clearInterval(renewal_timer);
    renewal_timer = undefined;
  };
  renewal_timer = setInterval(() => {
    void renew()
      .then((held) => {
        if (held) return;
        stop_renewing();
        on_lock_lost?.();
      })
      .catch(() => undefined);
  }, session_lock_renewal_interval_ms);
  if (typeof renewal_timer.unref === 'function') renewal_timer.unref();

  return {
    run_id: lock_input.run_id,
    renew,
    stop_renewing,
    async release(session_status = 'active') {
      stop_renewing();
      await release_session_execution_lock(db, {
        ...lock_input,
        session_status,
      });
    },
  };
}

async function renew_session_lock(db: Database, lock_input: SessionLockInput) {
  const renewed_session = await renew_session_execution_lock(db, {
    ...lock_input,
    lease_ms: session_lock_ttl_ms,
  });
  return Boolean(renewed_session);
}

function throw_session_lock_conflict(session_id: string): never {
  throw new ConflictError('Session already has an active runtime run', {
    session_id,
  });
}
