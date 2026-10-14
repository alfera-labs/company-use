import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { DecideRuntimeToolBatch, RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';

export type RuntimeAgentEngineEvent =
  | {
      type: 'message';
      message: RuntimeAgentMessage;
    }
  | {
      type: 'message_delta';
      delta: string;
      accumulated_text: string;
      content_index?: number;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'progress';
      label: string;
      delta?: string;
      content?: unknown;
      content_index?: number;
      metadata?: Record<string, unknown>;
    };

/**
 * What the engine knows at the start of a turn, before it asks the model. An engine that can
 * measure its context reports `context_tokens` and `context_window`; the pi engine always does.
 */
export type RuntimeTurnState = {
  turn_index: number;
  usage: RuntimeRunUsage;
  context_tokens?: number;
  context_window?: number;
};

/** A message the model reads before this turn. A hidden steer never enters the transcript. */
export type RuntimeTurnSteer = { text: string; hidden: true };

/** A before-turn answer: let the turn run, or let it run with steer messages in the model input. */
export type RuntimeTurnDecision =
  | { outcome: 'continue' }
  | { outcome: 'steer'; steers: readonly RuntimeTurnSteer[] };

/** Runs before each model turn. A throw stops the run with that error. */
export type BeforeRuntimeTurn = (state: RuntimeTurnState) => Promise<RuntimeTurnDecision | void>;

export type RuntimeAgentEngineInput = {
  run_key: string;
  session_key?: string;
  system_prompt: string;
  model: RuntimeModelConfig;
  messages: RuntimeAgentMessage[];
  tools: RuntimeToolDefinition[];
  environment?: SessionEnv;
  metadata: Record<string, unknown>;
  signal: AbortSignal;
  decide_tool_batch?: DecideRuntimeToolBatch;
  before_turn?: BeforeRuntimeTurn;
};

export type RuntimeAgentEngine = {
  engine_name: string;
  run(input: RuntimeAgentEngineInput): AsyncIterable<RuntimeAgentEngineEvent>;
};

export type CreateAgentRunInput = {
  run_key?: string;
  session_key?: string;
  system_prompt: string;
  model: RuntimeModelConfig;
  messages: RuntimeAgentMessage[];
  tools: RuntimeToolDefinition[];
  environment?: SessionEnv;
  metadata?: Record<string, unknown>;
  engine: RuntimeAgentEngine;
  decide_tool_batch?: DecideRuntimeToolBatch;
  before_turn?: BeforeRuntimeTurn;
};

type AgentRunStatus = 'completed' | 'failed' | 'aborted';

export type AgentRunResult = {
  run_key: string;
  session_key?: string;
  status: AgentRunStatus;
  final_message?: RuntimeAgentMessage;
  usage: RuntimeRunUsage;
  event_count: number;
  error?: {
    code: string;
    message: string;
  };
  metadata: Record<string, unknown>;
};

export type AgentRun = {
  abort(): void;
  wait_for_completion(): Promise<AgentRunResult>;
  events(): AsyncIterable<RuntimeRunEvent>;
  usage(): RuntimeRunUsage;
};
