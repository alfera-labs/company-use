import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { Database } from '@coworker/core';
import { create_usage_record } from '@coworker/core/db/queries/sessions';
import { create_logger } from '@coworker/shared';
import {
  calculate_llm_spend,
  type LlmBillingTreatment,
} from '@runtime-platform/orchestrator/llm_spend';
import type { SessionCompactionTierName } from '@runtime-platform/session_harness/session_compaction_tier';

const log = create_logger('session_compaction_spend');

const session_compaction_usage_kind = 'context_compaction';

const session_compaction_billing_treatment: LlmBillingTreatment = 'absorbed';

export type SessionCompactionSpendInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  summariser_model: RuntimeModelConfig;
  tier?: SessionCompactionTierName;
  usage: RuntimeRunUsage;
  summary_persisted: boolean;
  actor_id: string;
};

export async function record_session_compaction_spend(
  db: Database,
  input: SessionCompactionSpendInput,
): Promise<void> {
  const spend = calculate_llm_spend({
    usage: input.usage,
    billing_treatment: session_compaction_billing_treatment,
  });

  try {
    await create_usage_record(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      usage_kind: session_compaction_usage_kind,
      quantity: String(spend.total_tokens),
      unit: 'token',
      provider: input.summariser_model.model_provider,
      ...(input.summariser_model.model_proxy
        ? { model_proxy: input.summariser_model.model_proxy }
        : {}),
      cost_microcents: spend.billable_cost_microcents,
      usage_metadata: {
        ...spend.usage_metadata,
        compaction: {
          tier: input.tier ?? null,
          summary_persisted: input.summary_persisted,
          model_name: input.summariser_model.model_name,
        },
      },
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error(
      `failed to record compaction spend for run ${input.run_id} (${spend.provider_cost_microcents} provider microcents):`,
      error,
    );
  }
}
