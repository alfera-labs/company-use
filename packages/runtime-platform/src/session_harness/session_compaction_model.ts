import { type LlmEnvironment, resolve_llm_model } from '@agent-core/llm_gateway/model_resolver';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import { create_logger } from '@coworker/shared';

const log = create_logger('session_compaction_model');

export function resolve_session_compaction_model(
  session_model: RuntimeModelConfig,
  environment?: LlmEnvironment,
): RuntimeModelConfig {
  try {
    const resolved = environment
      ? resolve_llm_model({ use_case: 'session_summary' }, environment)
      : resolve_llm_model({ use_case: 'session_summary' });
    return {
      model_provider: resolved.model_provider,
      model_name: resolved.model_name,
      model_proxy: resolved.model_proxy,
      ...(resolved.reasoning_level === undefined
        ? {}
        : { reasoning_level: resolved.reasoning_level }),
    };
  } catch (error) {
    log.warn('compaction summary model unresolved, using the session model:', error);
    return session_model;
  }
}
