import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import { record_run_spend } from '@runtime-platform/orchestrator/run_spend';

type RunSpendBase = Omit<Parameters<typeof record_run_spend>[0], 'usage' | 'estimated_tokens'>;

export function create_run_spend_recorder(base: RunSpendBase, run_row_exists: () => boolean) {
  let recorded = false;
  return async (spend: { usage: RuntimeRunUsage; estimated_tokens?: number }) => {
    if (recorded || !run_row_exists()) return;
    recorded = true;
    await record_run_spend({
      ...base,
      usage: spend.usage,
      ...(spend.estimated_tokens === undefined ? {} : { estimated_tokens: spend.estimated_tokens }),
    });
  };
}
