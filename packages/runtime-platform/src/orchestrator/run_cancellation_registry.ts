import type { AgentRun } from '@agent-core/runs';

const active_agent_runs_by_run_id = new Map<string, AgentRun>();
const pending_cancel_lifetime_ms = 10 * 60_000;
const pending_cancel_expiry_by_run_id = new Map<string, number>();

export function register_active_agent_run(run_id: string, agent_run: AgentRun) {
  active_agent_runs_by_run_id.set(run_id, agent_run);
  const pending_cancel_expiry = pending_cancel_expiry_by_run_id.get(run_id);
  pending_cancel_expiry_by_run_id.delete(run_id);
  if (pending_cancel_expiry !== undefined && pending_cancel_expiry > Date.now()) {
    agent_run.abort();
  }

  return () => {
    if (active_agent_runs_by_run_id.get(run_id) === agent_run) {
      active_agent_runs_by_run_id.delete(run_id);
    }
  };
}

export function cancel_active_agent_run(run_id: string) {
  const active_agent_run = active_agent_runs_by_run_id.get(run_id);
  if (!active_agent_run) {
    remember_pending_cancel(run_id);
    return false;
  }

  active_agent_run.abort();
  return true;
}

function remember_pending_cancel(run_id: string) {
  const now = Date.now();
  for (const [pending_run_id, expiry] of pending_cancel_expiry_by_run_id) {
    if (expiry <= now) pending_cancel_expiry_by_run_id.delete(pending_run_id);
  }
  pending_cancel_expiry_by_run_id.set(run_id, now + pending_cancel_lifetime_ms);
}

export async function wait_for_agent_run_to_stop(run_id: string, deadline_ms: number) {
  const active_agent_run = active_agent_runs_by_run_id.get(run_id);
  if (!active_agent_run) return true;

  let deadline_timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    deadline_timer = setTimeout(() => resolve('deadline'), deadline_ms);
  });

  try {
    const outcome = await Promise.race([
      active_agent_run.wait_for_completion().then(
        () => 'stopped' as const,
        () => 'stopped' as const,
      ),
      deadline,
    ]);
    return outcome === 'stopped';
  } finally {
    clearTimeout(deadline_timer);
  }
}
