import { get_pi_model } from '@agent-core/engines/pi/pi_model';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';

export const session_context_message_limit = 300;

export const session_context_token_budget = 100_000;

// Half the window, but never past the ceiling and never more than 80% of a small window.
//
// A flat 100k budget on a 1,000,000-token model throws away most of the window: compaction fires
// at ~70k, a session loses its own history within hours, and the recaps rewrite user
// instructions that a bigger window would still hold in plain view. The ceiling
// stays under 200k because Anthropic bills the whole prompt at a premium above 200k input tokens
// — past that line a bigger window costs double, not more memory.
const session_context_window_fraction = 0.5;
const session_context_token_budget_ceiling = 180_000;
const session_context_small_window_fraction = 0.8;

export function session_context_token_budget_for_model(model?: RuntimeModelConfig): number {
  const context_window = read_model_context_window(model);
  if (!context_window || context_window <= 0) return session_context_token_budget;

  const scaled = Math.floor(context_window * session_context_window_fraction);
  const floor = Math.min(
    session_context_token_budget,
    Math.floor(context_window * session_context_small_window_fraction),
  );
  return Math.max(Math.min(scaled, session_context_token_budget_ceiling), floor);
}

function read_model_context_window(model?: RuntimeModelConfig) {
  if (!model) return undefined;
  try {
    return get_pi_model(model)?.contextWindow;
  } catch {
    return undefined;
  }
}
