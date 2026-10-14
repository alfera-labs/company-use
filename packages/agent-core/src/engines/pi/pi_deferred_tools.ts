// Keeps rarely-used tool definitions out of the model's context using Anthropic's deferred tool
// loading, without letting the tool block change shape from one call to the next.
//
// Why this lives at the provider-payload seam instead of driving pi's own deferral:
//
// pi already implements Anthropic deferred tools (utils/deferred-tools.ts), but it derives the
// deferred set from the transcript — a tool is deferred only once some tool result has named it in
// `addedToolNames`. That is the wrong shape for us twice over. On the first call of a run there are
// no tool results at all, so nothing can be deferred, and the first call is exactly where the whole
// tool block is billed at full price. And because the set is derived from the transcript, it grows
// as the run goes on: `tools` is the first thing in Anthropic's cache prefix (tools -> system ->
// messages), so a tool block that changes shape mid-run re-writes the cache for everything behind
// it. A set computed from the tool list alone is identical on call one and call fifty, and
// identical across every run in the workspace.
//
// Discovery uses the provider's own tool-search tool rather than a hand-rolled one: Anthropic loads
// a deferred definition by appending it to the transcript, so a tool becoming available costs
// nothing in the tool block and the cached prefix survives. pi's client-side `tool_reference` path
// keeps working unchanged — those blocks live in `messages`, behind the tool block.

import { create_logger, estimate_context_tokens_roughly } from '@coworker/shared';
import type { Api, Model } from '@earendil-works/pi-ai';

const log = create_logger('pi_deferred_tools');

const deferral_switch_env_name = 'COWORKER_DEFER_MODEL_TOOLS';
const always_loaded_tools_env_name = 'COWORKER_ALWAYS_LOADED_MODEL_TOOLS';

// Anthropic's server-side tool search. Regex over the deferred definitions, so the model can reach
// a tool whose schema it cannot see. No beta header, and its results append to the transcript.
const tool_search_tool_type = 'tool_search_tool_regex_20251119';
const tool_search_tool_name = 'tool_search_tool_regex';

export type ToolDeferralPolicy = {
  always_loaded_tool_names: ReadonlySet<string>;
};

export type ToolBlockMeasurement = {
  tool_count: number;
  loaded_tool_count: number;
  deferred_tool_count: number;
  estimated_loaded_tokens: number;
};

/**
 * The policy for this deployment, or undefined when tool deferral is off.
 *
 * Two variables so the tuned tool list survives being switched off and on during an A/B:
 * COWORKER_DEFER_MODEL_TOOLS is the switch, COWORKER_ALWAYS_LOADED_MODEL_TOOLS is the set of tool
 * names that stay in the prompt. An empty list with the switch on defers nothing — a run whose
 * every tool is deferred is a run with no tools, and Anthropic rejects it outright.
 */
export function read_tool_deferral_policy(
  env: Record<string, string | undefined>,
): ToolDeferralPolicy | undefined {
  if (!read_boolean_env(env[deferral_switch_env_name])) return undefined;

  const always_loaded_tool_names = new Set(
    (env[always_loaded_tools_env_name] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  if (always_loaded_tool_names.size === 0) return undefined;

  return { always_loaded_tool_names };
}

/**
 * Whether this model loads deferred tool definitions.
 *
 * Deferred loading is an Anthropic Messages feature, and pi routes the Vercel AI Gateway through
 * the same Anthropic Messages API — the payload shape is identical, but the model behind it may be
 * qwen, glm or gpt, none of which know what `defer_loading` means. Sending them a deferred tool
 * block hides two thirds of the tool set from a model that will never search for it. pi draws the
 * same line for its own deferral (`defaultSupportsToolReferences` returns false the moment the
 * provider is not anthropic), so gateway-routed runs simply keep the full tool block.
 */
export function provider_loads_deferred_tools(
  model: Pick<Model<Api>, 'provider' | 'compat'>,
): boolean {
  const compat = model.compat;
  if (
    compat &&
    'supportsToolReferences' in compat &&
    typeof compat.supportsToolReferences === 'boolean'
  ) {
    return compat.supportsToolReferences;
  }
  return model.provider === 'anthropic';
}

/**
 * Rewrite an Anthropic Messages payload so only the policy's tools are loaded into the model's
 * context, and the rest are reachable through the provider's tool search.
 *
 * The tool block is rebuilt in one canonical order — search tool, loaded tools by name, deferred
 * tools by name — so it is byte-identical whatever order the caller handed the tools in and
 * whatever pi's own transcript-derived split did to them. `messages` is never touched: a
 * `tool_reference` that loads a deferred definition sits behind the tool block in the cache prefix,
 * which is the entire point.
 *
 * Returns the payload unchanged when the transform cannot apply.
 */
export function defer_tools_in_anthropic_payload(
  payload: unknown,
  policy: ToolDeferralPolicy,
): unknown {
  const tools = read_deferrable_tools(read_tool_entries(payload));
  if (!tools) return payload;

  const loaded = tools.filter((tool) => policy.always_loaded_tool_names.has(tool.name));
  const deferred = tools.filter((tool) => !policy.always_loaded_tool_names.has(tool.name));
  warn_about_unmatched_always_loaded_names(policy, tools);
  // Nothing to save, or nothing left to anchor on: Anthropic answers an all-deferred tool block
  // with `All tools have defer_loading set`, and the search tool alone cannot rescue it.
  if (deferred.length === 0 || loaded.length === 0) return payload;

  const cache_control = read_tool_cache_control(tools);
  const loaded_in_order = sort_tools_by_name(loaded).map(strip_deferral_markers);
  const next_tools = [
    { type: tool_search_tool_type, name: tool_search_tool_name },
    ...loaded_in_order.map((tool, index) =>
      // One breakpoint, on the last tool the model can actually see. Deferred definitions are not
      // rendered into the context, so there is nothing behind it worth caching.
      index === loaded_in_order.length - 1 ? with_cache_control(tool, cache_control) : tool,
    ),
    ...sort_tools_by_name(deferred).map((tool) => ({
      ...strip_deferral_markers(tool),
      defer_loading: true,
    })),
  ];

  return { ...(payload as Record<string, unknown>), tools: next_tools };
}

/** What the tool block costs the model, for the before/after in the trace. */
export function measure_tool_block(payload: unknown): ToolBlockMeasurement {
  const tools = read_tool_entries(payload) ?? [];
  const loaded = tools.filter((tool) => tool.defer_loading !== true);

  return {
    tool_count: tools.length,
    loaded_tool_count: loaded.length,
    deferred_tool_count: tools.length - loaded.length,
    estimated_loaded_tokens: estimate_context_tokens_roughly(loaded),
  };
}

type AnthropicToolDefinition = {
  name: string;
  defer_loading?: boolean;
  cache_control?: unknown;
} & Record<string, unknown>;

function read_tool_entries(payload: unknown): AnthropicToolDefinition[] | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const tools = (payload as { tools?: unknown }).tools;
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  if (tools.some((tool) => tool === null || typeof tool !== 'object')) return undefined;

  return tools as AnthropicToolDefinition[];
}

function read_deferrable_tools(
  tools: AnthropicToolDefinition[] | undefined,
): AnthropicToolDefinition[] | undefined {
  if (!tools) return undefined;

  const definitions: AnthropicToolDefinition[] = [];
  for (const tool of tools) {
    if (tool.type === tool_search_tool_type) continue;
    if (typeof tool.name !== 'string' || typeof tool.type === 'string') return undefined;
    definitions.push(tool);
  }

  return definitions.length > 0 ? definitions : undefined;
}

function sort_tools_by_name(tools: AnthropicToolDefinition[]) {
  return [...tools].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

function read_tool_cache_control(tools: AnthropicToolDefinition[]) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const cache_control = tools[index]?.cache_control;
    if (cache_control !== undefined) return cache_control;
  }
  return undefined;
}

/**
 * The definition with both per-call markers removed, so this policy is the only thing that decides
 * them. pi runs its own transcript-derived deferral first and can hand us a tool already carrying
 * `defer_loading: true`; keeping it would hide a tool this deployment says must always be loaded,
 * and would do it silently. Rebuilding both markers from scratch also makes the transform
 * idempotent — running it twice produces the same bytes, which is the property the whole tool
 * block is here to hold.
 */
function strip_deferral_markers(tool: AnthropicToolDefinition) {
  if (tool.cache_control === undefined && tool.defer_loading === undefined) return tool;
  const { cache_control: _cache_control, defer_loading: _defer_loading, ...rest } = tool;
  return rest as AnthropicToolDefinition;
}

function with_cache_control(tool: AnthropicToolDefinition, cache_control: unknown) {
  if (cache_control === undefined) return tool;
  return { ...tool, cache_control };
}

function read_boolean_env(value: string | undefined) {
  const configured = value?.trim().toLowerCase();
  return configured === '1' || configured === 'true' || configured === 'on';
}

const warned_unmatched_tool_names = new Set<string>();

function warn_about_unmatched_always_loaded_names(
  policy: ToolDeferralPolicy,
  tools: AnthropicToolDefinition[],
) {
  const available_tool_names = new Set(tools.map((tool) => tool.name));
  const unmatched_tool_names = [...policy.always_loaded_tool_names]
    .filter((name) => !available_tool_names.has(name))
    .filter((name) => !warned_unmatched_tool_names.has(name));
  if (unmatched_tool_names.length === 0) return;

  for (const name of unmatched_tool_names) warned_unmatched_tool_names.add(name);
  log.warn(`${always_loaded_tools_env_name} names tools this run does not have.`, {
    unmatched_tool_names,
  });
}
