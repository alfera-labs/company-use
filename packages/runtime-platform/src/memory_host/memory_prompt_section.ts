import type { RunHookSourceInput } from '@runtime-platform/orchestrator/run_hooks';

export type PendingMemoryPromptText = {
  wait_within_budget(): Promise<string | null>;
};

export function start_memory_prompt_text(_input: RunHookSourceInput): PendingMemoryPromptText {
  return { wait_within_budget: async () => null };
}
