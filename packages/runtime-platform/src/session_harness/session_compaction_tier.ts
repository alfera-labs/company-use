import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import { session_context_token_budget_for_model } from '@runtime-platform/orchestrator/context/context_budget';

export const session_compaction_tiers = {
  soft: {
    budget_fraction: 0.7,
    operation_reason: 'session_context_soft_budget_exceeded',
    blocks_the_turn: false,
  },
  hard: {
    budget_fraction: 0.9,
    operation_reason: 'session_context_hard_budget_exceeded',
    blocks_the_turn: true,
  },
} as const;

export type SessionCompactionTierName = keyof typeof session_compaction_tiers;

export function session_compaction_tier_token_budget(
  tier: SessionCompactionTierName,
  model?: RuntimeModelConfig,
): number {
  return Math.floor(
    session_context_token_budget_for_model(model) * session_compaction_tiers[tier].budget_fraction,
  );
}
