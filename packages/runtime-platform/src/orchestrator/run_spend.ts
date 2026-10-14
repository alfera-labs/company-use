import { type RuntimeRunUsage, run_usage_has_any_model_call } from '@agent-core/runs/run_usage';
import type { Database } from '@coworker/core';
import { add_usage_to_run_totals, create_usage_record } from '@coworker/core/db/queries/sessions';
import {
  calculate_llm_spend,
  type LlmBillingTreatment,
} from '@runtime-platform/orchestrator/llm_spend';
import type { create_run_performance_tracker } from '@runtime-platform/orchestrator/run_performance';

type RunSpendInput = {
  db: Database;
  workspace_id: string;
  agent_id: string;
  session_id: string;
  run_id: string;
  model: { model_provider: string; model_proxy: string };
  billing_treatment: LlmBillingTreatment;
  usage: RuntimeRunUsage;
  estimated_tokens?: number;
  api_key_id?: string;
  performance: ReturnType<typeof create_run_performance_tracker>;
  actor_id: string;
};

function run_spend_totals(input: RunSpendInput, measured: boolean) {
  const spend = measured
    ? calculate_llm_spend({ usage: input.usage, billing_treatment: input.billing_treatment })
    : { billable_cost_microcents: 0, total_tokens: 0, usage_metadata: { estimated: true } };
  return {
    cost_microcents: spend.billable_cost_microcents,
    total_tokens: measured ? spend.total_tokens : (input.estimated_tokens ?? 0),
    usage_metadata: spend.usage_metadata,
  };
}

export async function record_run_spend(input: RunSpendInput) {
  const measured = run_usage_has_any_model_call(input.usage);
  if (!measured && input.estimated_tokens === undefined) return;

  const { cost_microcents, total_tokens, usage_metadata } = run_spend_totals(input, measured);

  await input.performance.measure_db_write(() =>
    add_usage_to_run_totals(input.db, {
      run_id: input.run_id,
      input_tokens: measured ? input.usage.input : (input.estimated_tokens ?? 0),
      output_tokens: measured ? input.usage.output : 0,
      cache_read_tokens: input.usage.cacheRead,
      cache_write_tokens: input.usage.cacheWrite,
      cost_microcents,
      usage_metadata,
      actor_id: input.actor_id,
    }),
  );

  await input.performance.measure_db_write(() =>
    create_usage_record(input.db, {
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      session_id: input.session_id,
      run_id: input.run_id,
      usage_kind: 'llm_tokens',
      quantity: String(total_tokens),
      unit: 'token',
      provider: input.model.model_provider,
      ...(input.api_key_id ? { api_key_id: input.api_key_id } : {}),
      model_proxy: input.model.model_proxy,
      cost_microcents,
      usage_metadata,
      actor_id: input.actor_id,
    }),
  );
}
