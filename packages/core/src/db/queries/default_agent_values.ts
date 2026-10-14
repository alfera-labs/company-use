import { env, product_brand_config } from '@coworker/config';
import {
  agent_model_config_schema,
  build_coworker_voice_guide,
  resolve_model_profile,
} from '@coworker/shared';

const previous_default_agent_prompts = [
  'You are a business-facing AI worker. Be concrete, use connected tools when useful, and report what happened.',
];

export function build_default_agent_values(current_agent_config?: unknown) {
  const product_brand_name = product_brand_config.product_brand_name;
  return {
    agent_slug: 'main',
    agent_name: `${product_brand_name} worker`,
    agent_description: 'Main AI worker for the workspace.',
    agent_status: 'active',
    agent_kind: 'main',
    system_prompt: build_default_agent_prompt(product_brand_name),
    ...build_default_model_values(current_agent_config),
  };
}

export function build_default_model_values(current_agent_config?: unknown) {
  const model = resolve_model_profile('customer_agent', env);
  return {
    default_model: model.model_name,
    default_model_provider: model.model_provider,
    default_model_name: model.model_name,
    agent_config: {
      ...agent_model_config_schema.parse(current_agent_config ?? {}),
      model_proxy: model.model_proxy,
      reasoning_level: model.reasoning_level,
    },
  };
}

export function is_legacy_agent_name(name: string) {
  return name === `${legacy_runtime_codename()} worker`;
}

export function has_previous_default_prompt(agent: { system_prompt?: string | null }) {
  return previous_default_agent_prompts.includes(agent.system_prompt?.trim() ?? '');
}

export function uses_legacy_local_model(agent: {
  default_model?: string | null;
  default_model_provider?: string | null;
  default_model_name?: string | null;
}) {
  return (
    agent.default_model_provider === 'local' ||
    agent.default_model === 'old-local-model' ||
    agent.default_model_name === 'old-local-model'
  );
}

function build_default_agent_prompt(product_brand_name: string) {
  return [
    build_coworker_voice_guide(product_brand_name),
    'You get things done: own each request end to end, use your tools, verify the outcome, and report what actually happened. No giving up.',
    'This voice is for talking to your teammates. Work you write for someone else to send or publish (an email, a post, a document) follows their voice and their instructions, not yours.',
  ].join('\n\n');
}

function legacy_runtime_codename() {
  return ['Runtime', 'Core'].join(' ');
}
