import { runtime_message_to_pi_message } from '@agent-core/engines/pi/pi_messages';
import {
  describe_pi_model,
  get_pi_model,
  get_pi_runtime_provider_name,
  resolve_runtime_model_api_key,
} from '@agent-core/engines/pi/pi_model';
import { create_authenticated_pi_models } from '@agent-core/engines/pi/pi_models';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import {
  type AgentMessage,
  type CompactionPreparation,
  type CompactionSettings,
  type CompactResult,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  prepareCompaction,
  type SessionTreeEntry,
  shouldCompact,
  type ThinkingLevel,
} from '@earendil-works/pi-agent-core';

export type { CompactionSettings as PiCompactionSettings, SessionTreeEntry as PiSessionTreeEntry };

export const PI_DEFAULT_COMPACTION_SETTINGS = DEFAULT_COMPACTION_SETTINGS;

// Pi compacts once context tokens pass `contextWindow - reserveTokens`. Callers that
// keep a fixed context budget want compaction to fire at exactly that budget, so
// reserve everything above it. Windows smaller than the budget keep the defaults,
// and an unknown model keeps them too — compaction settings are not the place to
// fail a run over a missing registry entry.
export function pi_compaction_settings_for_token_budget(
  model: RuntimeModelConfig,
  token_budget: number,
): CompactionSettings {
  const pi_model = get_pi_model(model);
  if (!pi_model) return DEFAULT_COMPACTION_SETTINGS;

  return {
    ...DEFAULT_COMPACTION_SETTINGS,
    reserveTokens: Math.max(
      DEFAULT_COMPACTION_SETTINGS.reserveTokens,
      pi_model.contextWindow - token_budget,
    ),
  };
}

export type PiCompactionPlan =
  | { status: 'not_needed'; context_tokens: number; context_window: number }
  | {
      status: 'prepared';
      context_tokens: number;
      context_window: number;
      preparation: CompactionPreparation;
    };

export type PiCompactionRunResult =
  | { ok: true; value: CompactResult }
  | { ok: false; error: Error };

export function runtime_messages_to_pi_agent_messages(
  messages: readonly RuntimeAgentMessage[],
): AgentMessage[] {
  return messages.flatMap((message) => {
    const pi_message = runtime_message_to_pi_message(message);
    return pi_message ? [pi_message] : [];
  });
}

// Pi ships two estimators and only one of them is usable as a compaction trigger.
// `estimateTokens` is a characters/4 heuristic per message; `estimateContextTokens` anchors on the
// last assistant message's reported provider usage and only estimates the messages after it. The
// heuristic under-counts badly on tool-heavy sessions, where results are JSON, URLs and markup
// rather than prose: it can read less than half of what the provider bills, so every trigger
// fires far above its configured budget and a long run rarely compacts. Anchor on real usage.
export function estimate_pi_context_tokens(messages: readonly AgentMessage[]) {
  return estimateContextTokens([...messages]).tokens;
}

export function prepare_pi_compaction(input: {
  entries: SessionTreeEntry[];
  model: RuntimeModelConfig;
  settings?: CompactionSettings;
}): PiCompactionPlan {
  const model = require_pi_model(input.model);
  const settings = input.settings ?? DEFAULT_COMPACTION_SETTINGS;
  const context_tokens = estimate_entry_tokens(input.entries);

  if (!shouldCompact(context_tokens, model.contextWindow, settings)) {
    return { status: 'not_needed', context_tokens, context_window: model.contextWindow };
  }

  const prepared = prepareCompaction(input.entries, settings);
  if (!prepared.ok) throw prepared.error;
  if (!prepared.value) {
    return { status: 'not_needed', context_tokens, context_window: model.contextWindow };
  }

  return {
    status: 'prepared',
    context_tokens,
    context_window: model.contextWindow,
    preparation: prepared.value,
  };
}

export async function run_pi_compaction(input: {
  preparation: CompactionPreparation;
  model: RuntimeModelConfig;
  custom_instructions?: string;
  signal?: AbortSignal;
}): Promise<PiCompactionRunResult> {
  const model = require_pi_model(input.model);
  const api_key = resolve_runtime_model_api_key(input.model);
  if (!api_key) return { ok: false, error: missing_api_key_error(input.model) };
  const models = await create_authenticated_pi_models(
    get_pi_runtime_provider_name(input.model),
    api_key,
  );

  const result = await compact(
    input.preparation,
    models,
    model,
    input.custom_instructions,
    input.signal,
    reasoning_level_to_pi_thinking(input.model.reasoning_level),
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, value: result.value };
}

function require_pi_model(model: RuntimeModelConfig) {
  const pi_model = get_pi_model(model);
  if (!pi_model)
    throw new Error(`Pi model not found for ${JSON.stringify(describe_pi_model(model))}`);
  return pi_model;
}

function missing_api_key_error(model: RuntimeModelConfig) {
  const descriptor = describe_pi_model(model);
  return new Error(`No API key configured for ${descriptor.model_proxy}`);
}

function reasoning_level_to_pi_thinking(
  reasoning_level: RuntimeModelConfig['reasoning_level'],
): ThinkingLevel | undefined {
  return reasoning_level === 'off' ? undefined : reasoning_level;
}

function messages_from_entries(entries: readonly SessionTreeEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.type !== 'message') return [];
    return [entry.message as AgentMessage];
  });
}

function estimate_entry_tokens(entries: readonly SessionTreeEntry[]) {
  return estimate_pi_context_tokens(messages_from_entries(entries));
}
