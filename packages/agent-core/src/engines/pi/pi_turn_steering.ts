import { estimate_pi_context_tokens } from '@agent-core/engines/pi/pi_compaction';
import { create_progress_event } from '@agent-core/engines/pi/pi_progress_event';
import type {
  RuntimeAgentEngineEvent,
  RuntimeTurnDecision,
  RuntimeTurnState,
  RuntimeTurnSteer,
} from '@agent-core/runs/agent_run';
import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

/** The progress label the engine emits when a hidden steer joins the model input. */
export const hidden_steer_event_label = 'run.hidden_steer';

type AnchoredSteer = { anchor: number | undefined; message: AgentMessage };

/** Reads what a before-turn hook may know at the start of a pi turn, the turn's prompt included. */
export function read_pi_turn_state(input: {
  turn_index: number;
  usage: RuntimeRunUsage;
  agent: Agent;
  pi_prompt: AgentMessage | undefined;
  pi_model: Model<Api>;
}): RuntimeTurnState {
  const messages = input.agent.state.messages;
  const prompt_is_pending = input.pi_prompt !== undefined && !messages.includes(input.pi_prompt);
  return {
    turn_index: input.turn_index,
    usage: input.usage,
    context_tokens: estimate_pi_context_tokens(
      prompt_is_pending && input.pi_prompt ? [...messages, input.pi_prompt] : messages,
    ),
    context_window: input.pi_model.contextWindow,
  };
}

/**
 * Holds the hidden steers of one run. A steer is pinned at the end of the first model request that
 * reads it, so every later request (and every retry) reads it in the same place. It never enters
 * the pi transcript, the run messages, or the final answer, and it never adds a model turn.
 */
export function create_pi_turn_steering() {
  const anchored: AnchoredSteer[] = [];

  return {
    accept(decision: RuntimeTurnDecision | void, turn_index: number): RuntimeAgentEngineEvent[] {
      if (!decision || decision.outcome !== 'steer') return [];
      for (const steer of decision.steers) {
        anchored.push({ anchor: undefined, message: hidden_steer_message(steer) });
      }
      return decision.steers.map((steer) =>
        create_progress_event(
          hidden_steer_event_label,
          { content: { text: steer.text } },
          {
            turn_index,
            hidden: steer.hidden,
          },
        ),
      );
    },
    async transform_context(messages: AgentMessage[]): Promise<AgentMessage[]> {
      for (const steer of anchored) steer.anchor ??= messages.length;
      return insert_anchored_steers(messages, anchored);
    },
  };
}

function hidden_steer_message(steer: RuntimeTurnSteer): AgentMessage {
  return { role: 'user', content: [{ type: 'text', text: steer.text }], timestamp: Date.now() };
}

function insert_anchored_steers(
  messages: readonly AgentMessage[],
  anchored: readonly AnchoredSteer[],
): AgentMessage[] {
  if (anchored.length === 0) return [...messages];
  const steered: AgentMessage[] = [];
  messages.forEach((message, index) => {
    steered.push(...steers_at(anchored, index), message);
  });
  const after_last = anchored.filter(
    (steer) => (steer.anchor ?? messages.length) >= messages.length,
  );
  steered.push(...after_last.map(to_message));
  return steered;
}

function steers_at(anchored: readonly AnchoredSteer[], index: number) {
  return anchored.filter((steer) => steer.anchor === index).map(to_message);
}

function to_message(steer: AnchoredSteer) {
  return steer.message;
}
