import {
  defer_tools_in_anthropic_payload,
  measure_tool_block,
  provider_loads_deferred_tools,
  read_tool_deferral_policy,
  type ToolDeferralPolicy,
} from '@agent-core/engines/pi/pi_deferred_tools';
import { create_pi_engine } from '@agent-core/engines/pi/pi_engine';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import type { ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pi_ai = vi.hoisted(() => ({
  stream_simple: vi.fn(),
}));

vi.mock('@agent-core/engines/pi/pi_models', async (import_original) => {
  const original = await import_original<typeof import('@agent-core/engines/pi/pi_models')>();
  const models = original.get_pi_models();
  const test_models = new Proxy(models, {
    get(target, property) {
      if (property === 'streamSimple') return pi_ai.stream_simple;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...original, get_pi_models: () => test_models };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const core_loop_tools = ['runtime-execute_tool-1', 'runtime-get_tool_schema-1', 'slack-respond-1'];
const rare_tools = ['math-calculate-1', 'runtime-image_search-1', 'runtime-set_agent_name-1'];
const policy: ToolDeferralPolicy = { always_loaded_tool_names: new Set(core_loop_tools) };

describe('read_tool_deferral_policy', () => {
  it('is off unless the switch and the loaded tool list are both set', () => {
    expect(read_tool_deferral_policy({})).toBeUndefined();
    expect(
      read_tool_deferral_policy({ COWORKER_DEFER_MODEL_TOOLS: '1' }),
      'the switch alone would defer every tool, which Anthropic rejects',
    ).toBeUndefined();
    expect(
      read_tool_deferral_policy({
        COWORKER_ALWAYS_LOADED_MODEL_TOOLS: core_loop_tools.join(','),
      }),
    ).toBeUndefined();
  });

  it('reads the loaded tool names when the switch is on', () => {
    expect(
      read_tool_deferral_policy({
        COWORKER_DEFER_MODEL_TOOLS: 'on',
        COWORKER_ALWAYS_LOADED_MODEL_TOOLS: ' runtime-execute_tool-1 , slack-respond-1 ,',
      }),
    ).toEqual({
      always_loaded_tool_names: new Set(['runtime-execute_tool-1', 'slack-respond-1']),
    });
  });
});

describe('defer_tools_in_anthropic_payload', () => {
  it('ships the same tool block bytes however the tools arrive', () => {
    const first_run = defer_tools_in_anthropic_payload(
      anthropic_payload([...core_loop_tools, ...rare_tools]),
      policy,
    );
    const later_turn = defer_tools_in_anthropic_payload(
      anthropic_payload([
        'runtime-set_agent_name-1',
        'slack-respond-1',
        'math-calculate-1',
        'runtime-execute_tool-1',
        'runtime-image_search-1',
        'runtime-get_tool_schema-1',
      ]),
      policy,
    );

    expect(read_tools(later_turn)).toEqual(read_tools(first_run));
    expect(JSON.stringify(read_tools(later_turn))).toBe(JSON.stringify(read_tools(first_run)));
  });

  it('loads only the policy tools and leaves the rest reachable through tool search', () => {
    const tools = read_tools(
      defer_tools_in_anthropic_payload(
        anthropic_payload([...core_loop_tools, ...rare_tools]),
        policy,
      ),
    );

    expect(tools[0]).toEqual({
      type: 'tool_search_tool_regex_20251119',
      name: 'tool_search_tool_regex',
    });
    expect(tools.filter((tool) => tool.defer_loading !== true).map((tool) => tool.name)).toEqual([
      'tool_search_tool_regex',
      'runtime-execute_tool-1',
      'runtime-get_tool_schema-1',
      'slack-respond-1',
    ]);
    expect(tools.filter((tool) => tool.defer_loading === true).map((tool) => tool.name)).toEqual([
      'math-calculate-1',
      'runtime-image_search-1',
      'runtime-set_agent_name-1',
    ]);
    expect(tools).toHaveLength(7);
  });

  it('puts the one cache breakpoint on the last tool the model can see', () => {
    const tools = read_tools(
      defer_tools_in_anthropic_payload(
        anthropic_payload([...core_loop_tools, ...rare_tools]),
        policy,
      ),
    );

    expect(
      tools.filter((tool) => tool.cache_control !== undefined).map((tool) => tool.name),
    ).toEqual(['slack-respond-1']);
  });

  it('makes a deferred tool available once it is referenced, without touching the tool block', () => {
    const before_reference = anthropic_payload([...core_loop_tools, ...rare_tools]);
    const after_reference = {
      ...before_reference,
      messages: [
        ...before_reference.messages,
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_search',
              content: [{ type: 'tool_reference', tool_name: 'runtime-image_search-1' }],
            },
          ],
        },
      ],
    };

    const deferred_before = defer_tools_in_anthropic_payload(before_reference, policy);
    const deferred_after = defer_tools_in_anthropic_payload(after_reference, policy);
    const referenced_tool = read_tools(deferred_after).find(
      (tool) => tool.name === 'runtime-image_search-1',
    );

    expect(referenced_tool).toMatchObject({
      name: 'runtime-image_search-1',
      defer_loading: true,
      input_schema: { type: 'object' },
    });
    expect(JSON.stringify(read_tools(deferred_after))).toBe(
      JSON.stringify(read_tools(deferred_before)),
    );
    expect(read_messages(deferred_after)).toEqual(after_reference.messages);
  });

  it('produces the same block when it runs over its own output', () => {
    const once = defer_tools_in_anthropic_payload(
      anthropic_payload([...core_loop_tools, ...rare_tools]),
      policy,
    );

    expect(JSON.stringify(read_tools(defer_tools_in_anthropic_payload(once, policy)))).toBe(
      JSON.stringify(read_tools(once)),
    );
  });

  it('loads a policy tool that arrived already marked deferred', () => {
    const payload = anthropic_payload([...core_loop_tools, ...rare_tools]);
    const pre_deferred = {
      ...payload,
      tools: payload.tools.map((tool) => ({ ...tool, defer_loading: true })),
    };

    const loaded_tool_names = read_tools(defer_tools_in_anthropic_payload(pre_deferred, policy))
      .filter((tool) => tool.defer_loading !== true && tool.name !== 'tool_search_tool_regex')
      .map((tool) => tool.name);

    expect(loaded_tool_names).toEqual([...core_loop_tools].sort());
  });

  it('warns once about an always-loaded name this run does not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const typo_policy: ToolDeferralPolicy = {
      always_loaded_tool_names: new Set([...core_loop_tools, 'slack-respond']),
    };
    const payload = anthropic_payload([...core_loop_tools, ...rare_tools]);

    defer_tools_in_anthropic_payload(payload, typo_policy);
    defer_tools_in_anthropic_payload(payload, typo_policy);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('slack-respond');
    warn.mockRestore();
  });

  it('keeps the whole tool block when the policy would defer every tool', () => {
    const payload = anthropic_payload(rare_tools);

    expect(defer_tools_in_anthropic_payload(payload, policy)).toBe(payload);
  });

  it('keeps the whole tool block when there is nothing to defer', () => {
    const payload = anthropic_payload(core_loop_tools);

    expect(defer_tools_in_anthropic_payload(payload, policy)).toBe(payload);
  });

  it('leaves a payload it cannot rebuild alone', () => {
    const no_tools = { model: 'claude-sonnet-5', messages: [] };
    const server_tools = {
      ...anthropic_payload([...core_loop_tools, ...rare_tools]),
      tools: [
        { type: 'web_search_20260209', name: 'web_search' },
        ...anthropic_payload(core_loop_tools).tools,
      ],
    };

    expect(defer_tools_in_anthropic_payload(no_tools, policy)).toBe(no_tools);
    expect(defer_tools_in_anthropic_payload(server_tools, policy)).toBe(server_tools);
  });
});

describe('provider_loads_deferred_tools', () => {
  it('holds deferral to first-party Anthropic, so gateway runs keep the full tool block', () => {
    expect(provider_loads_deferred_tools({ provider: 'anthropic' })).toBe(true);
    expect(provider_loads_deferred_tools({ provider: 'vercel-ai-gateway' })).toBe(false);
    expect(provider_loads_deferred_tools({ provider: 'openai' })).toBe(false);
  });

  it('follows an explicit model opt-in either way', () => {
    expect(
      provider_loads_deferred_tools({
        provider: 'vercel-ai-gateway',
        compat: { supportsToolReferences: true },
      }),
    ).toBe(true);
    expect(
      provider_loads_deferred_tools({
        provider: 'anthropic',
        compat: { supportsToolReferences: false },
      }),
    ).toBe(false);
  });
});

describe('measure_tool_block', () => {
  it('prices what the model can see, not what the request carries', () => {
    const full = anthropic_payload([...core_loop_tools, ...rare_tools]);
    const deferred = defer_tools_in_anthropic_payload(full, policy);

    const before = measure_tool_block(full);
    const after = measure_tool_block(deferred);

    expect(before).toMatchObject({ tool_count: 6, loaded_tool_count: 6, deferred_tool_count: 0 });
    expect(after).toMatchObject({ tool_count: 7, loaded_tool_count: 4, deferred_tool_count: 3 });
    expect(after.estimated_loaded_tokens).toBeLessThan(before.estimated_loaded_tokens);
  });
});

describe('create_pi_engine tool deferral', () => {
  it('ships the payload untouched when the flag is off', async () => {
    const payload = anthropic_payload([...core_loop_tools, ...rare_tools]);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    vi.stubEnv('COWORKER_DEFER_MODEL_TOOLS', '');
    vi.stubEnv('COWORKER_ALWAYS_LOADED_MODEL_TOOLS', core_loop_tools.join(','));

    expect(await ship_payload_through_engine(payload)).toBe(payload);
  });

  it('defers the unlisted tools when the flag is on', async () => {
    const payload = anthropic_payload([...core_loop_tools, ...rare_tools]);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    vi.stubEnv('COWORKER_DEFER_MODEL_TOOLS', '1');
    vi.stubEnv('COWORKER_ALWAYS_LOADED_MODEL_TOOLS', core_loop_tools.join(','));

    const shipped = await ship_payload_through_engine(payload);

    expect(shipped).not.toBe(payload);
    expect(read_tools(shipped).filter((tool) => tool.defer_loading === true)).toHaveLength(3);
  });

  it('keeps the full tool block on a gateway-proxied Anthropic model', async () => {
    const payload = anthropic_payload([...core_loop_tools, ...rare_tools]);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test-gateway-key');
    vi.stubEnv('COWORKER_DEFER_MODEL_TOOLS', '1');
    vi.stubEnv('COWORKER_ALWAYS_LOADED_MODEL_TOOLS', core_loop_tools.join(','));

    expect(
      await ship_payload_through_engine(payload, {
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    ).toBe(payload);
  });
});

type TestToolDefinition = {
  name: string;
  defer_loading?: boolean;
  cache_control?: unknown;
} & Record<string, unknown>;

function anthropic_payload(tool_names: string[]) {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 8192,
    stream: true as const,
    system: [{ type: 'text', text: 'Keep the response operational.' }],
    messages: [{ role: 'user', content: 'Draft a launch update.' }],
    tools: tool_names.map((name, index) => ({
      name,
      description: `Runs ${name} for the workspace.`,
      eager_input_streaming: true,
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      ...(index === tool_names.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    })),
  };
}

function read_tools(payload: unknown): TestToolDefinition[] {
  return (payload as { tools: TestToolDefinition[] }).tools;
}

function read_messages(payload: unknown): unknown {
  return (payload as { messages: unknown }).messages;
}

async function ship_payload_through_engine(
  payload: unknown,
  model?: { model_proxy?: string; model_name?: string },
) {
  let shipped_payload: unknown;
  pi_ai.stream_simple.mockImplementation(
    async (
      stream_model: { provider: string; id: string },
      _context: unknown,
      options: ModelsSimpleStreamOptions,
    ) => {
      shipped_payload = await options.onPayload?.(
        payload,
        stream_model as Parameters<NonNullable<ModelsSimpleStreamOptions['onPayload']>>[1],
      );
      return create_assistant_stream();
    },
  );

  await collect_events(create_pi_engine().run(create_test_engine_input(model)));
  return shipped_payload;
}

function create_test_engine_input(model?: {
  model_proxy?: string;
  model_name?: string;
}): RuntimeAgentEngineInput {
  return {
    run_key: 'run_test',
    session_key: 'session_test',
    system_prompt: 'Keep the response operational.',
    model: {
      model_provider: 'anthropic',
      model_name: model?.model_name ?? 'claude-sonnet-5',
      ...(model?.model_proxy === undefined ? {} : { model_proxy: model.model_proxy }),
      reasoning_level: 'low',
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Draft a launch update.' }] }],
    tools: [],
    metadata: {},
    signal: new AbortController().signal,
  };
}

function create_assistant_stream() {
  const message = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'Done.' }],
    api: 'anthropic-messages' as const,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    usage: {
      input: 10,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 14,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: 'stop', message };
    },
    async result() {
      return message;
    },
  };
}

async function collect_events(events: AsyncIterable<RuntimeAgentEngineEvent>) {
  const collected_events: RuntimeAgentEngineEvent[] = [];
  for await (const event of events) collected_events.push(event);
  return collected_events;
}
