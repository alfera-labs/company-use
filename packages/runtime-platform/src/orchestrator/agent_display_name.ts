import { product_brand_config } from '@coworker/config';

export function with_agent_display_name(
  system_instructions: string,
  agent_name: string | null | undefined,
) {
  const name = agent_name?.trim();
  if (!name || name === `${product_brand_config.product_brand_name} worker`) {
    return system_instructions;
  }
  return `${system_instructions}\nThe team named you ${name}. Refer to yourself as ${name}.`;
}
