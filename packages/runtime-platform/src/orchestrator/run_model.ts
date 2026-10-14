import type { RuntimeReasoningLevel } from '@agent-core/models/runtime_model_config';
import { env } from '@coworker/config';
import type { RunTriggerType } from '@coworker/core/db/queries/sessions';
import { resolve_model } from '@runtime-platform/model_resolver';
import type { ModelResolutionInputs } from '@runtime-platform/orchestrator/run_start_reads';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';

type RunModelInput = Pick<
  StartAgentRunInput,
  | 'workspace_id'
  | 'model_provider'
  | 'model_proxy'
  | 'model_name'
  | 'trigger_type'
  | 'reasoning_level'
  | 'temperature'
  | 'max_output_tokens'
>;

const run_trigger_types_nobody_waits_on = new Set<RunTriggerType>(['schedule', 'app_event']);

function nobody_is_waiting_on(trigger_type: RunTriggerType) {
  return run_trigger_types_nobody_waits_on.has(trigger_type);
}

export function resolve_run_model(input: RunModelInput, reads: ModelResolutionInputs) {
  const [agent, , , workspace_model_environment, paid_model_access] = reads;
  const resolved_model = resolve_model(
    {
      workspace_id: input.workspace_id,
      model_provider: input.model_provider ?? null,
      model_proxy: input.model_proxy ?? null,
      model_name: input.model_name ?? null,
      default_model: agent?.default_model ?? null,
      default_model_provider: agent?.default_model_provider ?? null,
      default_model_name: agent?.default_model_name ?? null,
      agent_config: agent?.agent_config ?? null,
      model_access: {
        model_access: paid_model_access,
        gateway_models_enabled: env.MODEL_GATEWAY_UNLOCKED,
      },
      nobody_is_waiting: nobody_is_waiting_on(input.trigger_type ?? 'user_message'),
    },
    workspace_model_environment,
  );
  const model = {
    ...resolved_model,
    ...(input.reasoning_level === undefined ? {} : { reasoning_level: input.reasoning_level }),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: input.max_output_tokens }),
  };
  return { resolved_model, model };
}

export function runtime_model_from_resolved_model(model: {
  model_provider: string;
  model_proxy: string;
  model_name: string;
  api_key?: string;
  reasoning_level?: RuntimeReasoningLevel;
  temperature?: number;
  max_output_tokens?: number;
}) {
  return {
    model_provider: model.model_provider,
    model_proxy: model.model_proxy,
    model_name: model.model_name,
    ...(model.api_key === undefined ? {} : { api_key: model.api_key }),
    ...(model.reasoning_level === undefined ? {} : { reasoning_level: model.reasoning_level }),
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: model.max_output_tokens }),
  };
}
