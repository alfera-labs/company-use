import type { MemoryRun } from '@runtime-platform/memory_host/memory_run_hooks';
import type { RunHookSourceInput } from '@runtime-platform/orchestrator/run_hooks';

export type MemoryRunSource = Pick<
  RunHookSourceInput,
  'db' | 'workspace_id' | 'session_id' | 'run_id' | 'actor_id'
>;

export async function open_memory_run(_input: MemoryRunSource): Promise<MemoryRun | null> {
  return null;
}
