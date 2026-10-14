import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngine } from '@agent-core/runs';

type CreateAgentEngine = () => RuntimeAgentEngine;

let configured_create_engine: CreateAgentEngine = create_pi_engine;

/** Sets how each agent run makes its model engine. The default is the pi engine. */
export function configure_agent_engine(create_engine: CreateAgentEngine) {
  configured_create_engine = create_engine;
}

/** Makes the model engine for one agent run. */
export function create_agent_engine(): RuntimeAgentEngine {
  return configured_create_engine();
}
