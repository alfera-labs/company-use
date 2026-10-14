import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { Database } from '@coworker/core';
import type { AppError } from '@coworker/shared';

export function create_mid_run_credit_gate(_input: { db: Database; workspace_id: string }) {
  return {
    stop_error: (): AppError | undefined => undefined,
    async before_turn(_state: { turn_index: number; usage: RuntimeRunUsage }) {},
  };
}
