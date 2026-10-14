const hosted_setup_strategy_types = new Set(['connect_token', 'hosted_connect_link']);

export function is_hosted_setup_strategy(setup_strategy: Record<string, unknown>) {
  return (
    typeof setup_strategy.type === 'string' && hosted_setup_strategy_types.has(setup_strategy.type)
  );
}
