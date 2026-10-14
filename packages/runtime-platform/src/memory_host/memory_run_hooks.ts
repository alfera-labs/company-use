import {
  empty_run_hooks,
  type RunHookSourceInput,
  type RunHooks,
} from '@runtime-platform/orchestrator/run_hooks';

export type MemoryRun = never;

export async function open_memory_run_hooks(_input: RunHookSourceInput): Promise<RunHooks> {
  return empty_run_hooks;
}
