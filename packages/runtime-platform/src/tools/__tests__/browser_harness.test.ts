import { browse_tool_name } from '@agent-core/browser/browse_agent';
import { browser_tool_name } from '@agent-core/browser/browser_tool';
import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeAgentEngine, RuntimeAgentEngineInput } from '@agent-core/runs/agent_run';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  type BrowserToolAssemblyInput,
  create_browser_tool_definitions,
  is_browser_available,
  resolve_browser_harness_mode,
  resolve_browser_max_steps,
  resolve_browser_model,
} from '@runtime-platform/tools/browser_harness';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core_mocks = vi.hoisted(() => ({
  create_run: vi.fn(),
  get_run: vi.fn(),
  get_runtime_environment: vi.fn(),
  upsert_runtime_environment_active_preview: vi.fn(),
  update_run_status: vi.fn(),
  add_usage_to_run_totals: vi.fn(),
  update_run_performance_metrics: vi.fn(),
  create_tool_call_started: vi.fn(),
  find_tool_call_by_idempotency_key: vi.fn(),
  update_tool_call_finished: vi.fn(),
  create_run_event: vi.fn(),
  create_run_message: vi.fn(),
  replace_tool_result_message: vi.fn(),
  create_usage_record: vi.fn(),
}));

vi.mock('@coworker/core/db/queries/sessions', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/core/db/queries/sessions')>();
  return { ...actual, ...core_mocks };
});

const stub_db = {} as Database;

function remote_sandbox_input(): BrowserToolAssemblyInput {
  const environment: SessionEnv = {
    env_key: 'sandbox_1',
    env_kind: 'remote_sandbox',
    metadata: { provider_sandbox_id: 'sandbox_1' },
    exec: (input) => {
      if (input.args?.join(' ').endsWith('skills get core')) {
        return Promise.resolve({ exit_code: 0, stdout: '# agent-browser core', stderr: '' });
      }
      return Promise.resolve({ exit_code: 0, stdout: 'Done', stderr: '' });
    },
    start_preview: vi.fn().mockResolvedValue({
      port: 4820,
      provider_host: '4820-sandbox-1.e2b.app',
      process_id: 42,
      command: 'node /opt/coworker/browser/live-view-relay.mjs',
      cwd: '/home/user/share',
    }),
  };
  return {
    workspace_id: 'ws_1',
    session_id: 'sesn_1',
    run_id: 'run_1',
    agent_id: 'agent_1',
    runtime_environment_id: 'rte_1',
    environment,
    actor_id: 'user_1',
  };
}

function scripted_engine(): RuntimeAgentEngine {
  return {
    engine_name: 'scripted',
    async *run(input: RuntimeAgentEngineInput) {
      yield {
        type: 'message' as const,
        message: {
          role: 'assistant' as const,
          content: [
            {
              type: 'tool_call' as const,
              id: 'call_1',
              name: 'browser',
              arguments: { command: 'open https://example.com' },
            },
          ],
          metadata: {
            usage: {
              input: 100,
              output: 20,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 120,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        },
      };
      const tool = input.tools[0];
      if (!tool?.execute) throw new Error('no executable browser tool');
      await tool.execute(
        { command: 'open https://example.com' },
        { run_key: input.run_key, tool_call_id: 'call_1', metadata: {} },
      );
      yield {
        type: 'message' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Title is Example Domain.' }],
          metadata: {
            usage: {
              input: 100,
              output: 20,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 120,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        },
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  core_mocks.get_run.mockResolvedValue({ run_id: 'run_1', root_run_id: 'run_root' });
  core_mocks.create_run.mockResolvedValue({ run_id: 'run_child' });
  core_mocks.get_runtime_environment.mockResolvedValue({
    runtime_environment_id: 'rte_1',
    environment_metadata: {},
  });
  core_mocks.upsert_runtime_environment_active_preview.mockResolvedValue({});
  core_mocks.update_run_status.mockResolvedValue({});
  core_mocks.add_usage_to_run_totals.mockResolvedValue({});
  core_mocks.update_run_performance_metrics.mockResolvedValue({});
  core_mocks.create_tool_call_started.mockResolvedValue({
    tool_call_id: 'tc_1',
    run_id: 'run_1',
    tool_name: 'browser',
    tool_status: 'executing',
  });
  core_mocks.update_tool_call_finished.mockResolvedValue({
    tool_call_id: 'tc_1',
    run_id: 'run_1',
    tool_name: 'browser',
    tool_status: 'completed',
    duration_ms: 5,
  });
  core_mocks.create_run_event.mockResolvedValue({ run_event_id: 'evt_1', event_sequence: 1 });
  core_mocks.create_run_message.mockResolvedValue({ run_message_id: 'msg_1' });
  core_mocks.create_usage_record.mockResolvedValue({});
});

describe('resolve_browser_harness_mode', () => {
  it('reads a valid mode from config', () => {
    expect(['off', 'direct', 'subagent']).toContain(resolve_browser_harness_mode());
  });
});

describe('resolve_browser_model', () => {
  it('reads the browser-tuned model from config', () => {
    const model = resolve_browser_model();
    expect(model.model_provider.length).toBeGreaterThan(0);
    expect(model.model_name.length).toBeGreaterThan(0);
  });
});

describe('resolve_browser_max_steps', () => {
  it('reads the command budget from config and keeps it high enough for long runs', () => {
    expect(resolve_browser_max_steps()).toBe(env.COWORKER_BROWSER_MAX_STEPS);
    expect(resolve_browser_max_steps()).toBeGreaterThanOrEqual(100);
  });
});

describe('is_browser_available', () => {
  const remote_env = remote_sandbox_input().environment;

  it('is true for a remote sandbox with the harness on', () => {
    expect(is_browser_available(remote_env, 'direct')).toBe(true);
    expect(is_browser_available(remote_env, 'subagent')).toBe(true);
  });

  it('is false when the harness is off', () => {
    expect(is_browser_available(remote_env, 'off')).toBe(false);
  });

  it('is false without a remote-sandbox environment', () => {
    expect(is_browser_available(undefined, 'direct')).toBe(false);
    expect(
      is_browser_available(
        {
          env_key: 'local',
          env_kind: 'local',
          exec: () => Promise.resolve({ exit_code: 0, stdout: '', stderr: '' }),
        },
        'direct',
      ),
    ).toBe(false);
  });
});

describe('create_browser_tool_definitions', () => {
  it('exposes the high-level browse tool in subagent mode', () => {
    const tools = create_browser_tool_definitions(stub_db, remote_sandbox_input(), 'subagent');
    expect(tools.map((tool) => tool.tool_name)).toEqual([browse_tool_name]);
  });

  it('exposes the low-level browser tool in direct mode', () => {
    const tools = create_browser_tool_definitions(stub_db, remote_sandbox_input(), 'direct');
    expect(tools.map((tool) => tool.tool_name)).toEqual([browser_tool_name]);
  });

  it('exposes nothing when off', () => {
    expect(create_browser_tool_definitions(stub_db, remote_sandbox_input(), 'off')).toEqual([]);
  });

  it('exposes nothing on a non-remote-sandbox environment (no agent-browser there)', () => {
    const local_input: BrowserToolAssemblyInput = {
      ...remote_sandbox_input(),
      environment: {
        env_key: 'local',
        env_kind: 'local',
        exec: () => Promise.resolve({ exit_code: 0, stdout: '', stderr: '' }),
      },
    };
    expect(create_browser_tool_definitions(stub_db, local_input, 'subagent')).toEqual([]);
  });

  it('exposes nothing when there is no environment', () => {
    const no_env: BrowserToolAssemblyInput = { ...remote_sandbox_input(), environment: undefined };
    expect(create_browser_tool_definitions(stub_db, no_env, 'subagent')).toEqual([]);
  });
});

describe('direct mode browser tool logging', () => {
  it('records each command as a started + finished tool_calls row linked to the model tool-call id', async () => {
    const drafts: Array<{ event_type: string }> = [];
    const [browser] = create_browser_tool_definitions(
      stub_db,
      {
        ...remote_sandbox_input(),
        emit_chat_stream_event_drafts: (batch) => {
          drafts.push(...batch);
        },
      },
      'direct',
    );
    const result = await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_model_1', metadata: {} },
    );

    expect(result).toMatchObject({ ok: true });
    expect(core_mocks.create_tool_call_started).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({
        workspace_id: 'ws_1',
        session_id: 'sesn_1',
        run_id: 'run_1',
        agent_id: 'agent_1',
        tool_name: browser_tool_name,
        tool_input: { command: 'open https://example.com' },
        tool_call_metadata: expect.objectContaining({ runtime_tool_call_id: 'call_model_1' }),
        actor_id: 'user_1',
      }),
    );
    expect(core_mocks.update_tool_call_finished).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({
        tool_call_id: 'tc_1',
        tool_status: 'completed',
        duration_ms: expect.any(Number),
      }),
    );
    expect(core_mocks.create_run_message).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({
        run_id: 'run_1',
        message_role: 'tool_result',
        tool_call_id: 'tc_1',
        source_metadata: expect.objectContaining({
          tool_name: browser_tool_name,
          model_tool_call_id: 'call_model_1',
        }),
      }),
    );
    expect(drafts.map((draft) => draft.event_type)).toEqual(['item_started', 'item_completed']);
  });

  it('records a failed row when the browser command fails', async () => {
    const failing_input: BrowserToolAssemblyInput = {
      ...remote_sandbox_input(),
      environment: {
        env_key: 'sandbox_1',
        env_kind: 'remote_sandbox',
        metadata: { provider_sandbox_id: 'sandbox_1' },
        exec: () => Promise.resolve({ exit_code: 124, stdout: '', stderr: 'timed out' }),
      },
    };
    const [browser] = create_browser_tool_definitions(stub_db, failing_input, 'direct');
    const result = await browser?.execute?.(
      { command: 'wait --load networkidle' },
      { run_key: 'run_1', tool_call_id: 'call_model_2', metadata: {} },
    );

    expect(result).toMatchObject({ ok: false });
    expect(core_mocks.update_tool_call_finished).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({ tool_call_id: 'tc_1', tool_status: 'failed' }),
    );
  });

  it('starts and persists one interactive dashboard after the first successful command', async () => {
    const input = remote_sandbox_input();
    const start_preview = vi.mocked(input.environment?.start_preview);
    const [browser] = create_browser_tool_definitions(stub_db, input, 'direct');

    await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_1', metadata: {} },
    );
    await browser?.execute?.(
      { command: 'snapshot -i' },
      { run_key: 'run_1', tool_call_id: 'call_2', metadata: {} },
    );

    await vi.waitFor(() =>
      expect(core_mocks.upsert_runtime_environment_active_preview).toHaveBeenCalledOnce(),
    );
    expect(start_preview).toHaveBeenCalledOnce();
    expect(start_preview).toHaveBeenCalledWith({
      command: 'node',
      args: ['/opt/coworker/browser/live-view-relay.mjs'],
      port: 4820,
      env: {
        LIVE_VIEW_RELAY_PORT: '4820',
        AGENT_BROWSER_STREAM_PORT: '4849',
        AGENT_BROWSER_LIVE_VIEW_TOKEN: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      ready_path: '/',
      timeout_ms: 15_000,
    });
    expect(core_mocks.upsert_runtime_environment_active_preview).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({
        runtime_environment_id: 'rte_1',
        preview_port: 4820,
        active_preview: expect.objectContaining({
          preview_kind: 'browser_live_view',
          preview_transport: 'provider_direct',
          preview_url: 'https://4820-sandbox-1.e2b.app',
          live_view_token: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('reuses an already-persisted browser dashboard instead of restarting it', async () => {
    core_mocks.get_runtime_environment.mockResolvedValue({
      runtime_environment_id: 'rte_1',
      environment_metadata: {
        active_preview: {
          port: 4820,
          preview_kind: 'browser_live_view',
          provider_sandbox_id: 'sandbox_1',
        },
      },
    });
    const input = remote_sandbox_input();
    const start_preview = vi.mocked(input.environment?.start_preview);
    const [browser] = create_browser_tool_definitions(stub_db, input, 'direct');

    await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_1', metadata: {} },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(start_preview).not.toHaveBeenCalled();
  });

  it('restarts a persisted dashboard after the provider sandbox changes', async () => {
    core_mocks.get_runtime_environment.mockResolvedValue({
      runtime_environment_id: 'rte_1',
      environment_metadata: {
        active_preview: {
          port: 4820,
          preview_kind: 'browser_live_view',
          provider_sandbox_id: 'sandbox_previous',
        },
      },
    });
    const input = remote_sandbox_input();
    const start_preview = vi.mocked(input.environment?.start_preview);
    const [browser] = create_browser_tool_definitions(stub_db, input, 'direct');

    await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_1', metadata: {} },
    );

    await vi.waitFor(() => expect(start_preview).toHaveBeenCalledOnce());
    expect(core_mocks.upsert_runtime_environment_active_preview).toHaveBeenCalledWith(
      stub_db,
      expect.objectContaining({
        active_preview: expect.objectContaining({
          provider_sandbox_id: 'sandbox_1',
        }),
      }),
    );
  });

  it('restarts a persisted dashboard when its local server has stopped', async () => {
    core_mocks.get_runtime_environment.mockResolvedValue({
      runtime_environment_id: 'rte_1',
      environment_metadata: {
        active_preview: {
          port: 4820,
          preview_kind: 'browser_live_view',
          provider_sandbox_id: 'sandbox_1',
        },
      },
    });
    const input = remote_sandbox_input();
    const environment = input.environment;
    if (!environment) throw new Error('remote sandbox input must include an environment');
    const original_exec = environment.exec;
    environment.exec = vi.fn((command) =>
      command.command === 'curl'
        ? Promise.resolve({ exit_code: 7, stdout: '', stderr: 'connection refused' })
        : (original_exec?.(command) ??
          Promise.resolve({ exit_code: 1, stdout: '', stderr: 'exec unavailable' })),
    );
    const start_preview = vi.mocked(environment.start_preview);
    const [browser] = create_browser_tool_definitions(stub_db, input, 'direct');

    await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_1', metadata: {} },
    );

    await vi.waitFor(() => expect(start_preview).toHaveBeenCalledOnce());
  });

  it('keeps browser commands working and retries when the dashboard start fails', async () => {
    const input = remote_sandbox_input();
    const start_preview = vi.mocked(input.environment?.start_preview);
    start_preview
      ?.mockRejectedValueOnce(new Error('dashboard port unavailable'))
      .mockResolvedValueOnce({
        port: 4820,
        provider_host: '4820-sandbox-1.e2b.app',
        process_id: 42,
        command: 'node /opt/coworker/browser/live-view-relay.mjs',
        cwd: '/home/user/share',
      });
    const [browser] = create_browser_tool_definitions(stub_db, input, 'direct');

    const first = await browser?.execute?.(
      { command: 'open https://example.com' },
      { run_key: 'run_1', tool_call_id: 'call_1', metadata: {} },
    );
    await vi.waitFor(() => expect(start_preview).toHaveBeenCalledOnce());
    const second = await browser?.execute?.(
      { command: 'snapshot -i' },
      { run_key: 'run_1', tool_call_id: 'call_2', metadata: {} },
    );

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    await vi.waitFor(() => {
      expect(start_preview).toHaveBeenCalledTimes(2);
      expect(core_mocks.upsert_runtime_environment_active_preview).toHaveBeenCalledOnce();
    });
  });
});

describe('subagent browse on the agent engine', () => {
  it('runs the sub-agent on the injected engine and returns final text + usage', async () => {
    const [browse] = create_browser_tool_definitions(
      stub_db,
      remote_sandbox_input(),
      'subagent',
      scripted_engine(),
    );
    const result = await browse?.execute?.(
      { task: 'Open example.com and report the title.' },
      { run_key: 'run_1', metadata: {} },
    );
    expect(result).toMatchObject({
      ok: true,
      content_text: 'Title is Example Domain.',
      metadata: { step_count: 2, total_tokens: 240, browser_run_id: 'run_child' },
    });
    expect(core_mocks.create_tool_call_started).toHaveBeenNthCalledWith(
      1,
      stub_db,
      expect.objectContaining({
        workspace_id: 'ws_1',
        session_id: 'sesn_1',
        run_id: 'run_1',
        agent_id: 'agent_1',
        tool_name: browse_tool_name,
        tool_input: { task: 'Open example.com and report the title.' },
        actor_id: 'user_1',
      }),
    );
  });

  it('opens a logged CHILD run with parent + root lineage and the browser model', async () => {
    const [browse] = create_browser_tool_definitions(
      stub_db,
      remote_sandbox_input(),
      'subagent',
      scripted_engine(),
    );
    await browse?.execute?.({ task: 'do a web task' }, { run_key: 'run_1', metadata: {} });

    const model = resolve_browser_model();
    expect(core_mocks.create_run).toHaveBeenCalledWith(stub_db, {
      workspace_id: 'ws_1',
      session_id: 'sesn_1',
      agent_id: 'agent_1',
      trigger_type: 'api',
      parent_run_id: 'run_1',
      root_run_id: 'run_root',
      model_provider: model.model_provider,
      model_proxy: model.model_proxy,
      model_name: model.model_name,
      actor_id: 'user_1',
    });
    expect(core_mocks.update_run_status).toHaveBeenNthCalledWith(1, stub_db, {
      run_id: 'run_child',
      run_status: 'running',
      actor_id: 'user_1',
    });
    expect(core_mocks.update_run_status).toHaveBeenLastCalledWith(stub_db, {
      run_id: 'run_child',
      run_status: 'completed',
      actor_id: 'user_1',
    });
    expect(core_mocks.add_usage_to_run_totals).toHaveBeenCalledWith(stub_db, {
      run_id: 'run_child',
      input_tokens: 200,
      output_tokens: 40,
      actor_id: 'user_1',
    });
  });

  it('records every agent-browser command as a tool_call on the child run', async () => {
    const [browse] = create_browser_tool_definitions(
      stub_db,
      remote_sandbox_input(),
      'subagent',
      scripted_engine(),
    );
    await browse?.execute?.({ task: 'do a web task' }, { run_key: 'run_1', metadata: {} });

    expect(core_mocks.create_tool_call_started).toHaveBeenCalledWith(stub_db, {
      workspace_id: 'ws_1',
      session_id: 'sesn_1',
      run_id: 'run_child',
      agent_id: 'agent_1',
      tool_name: 'agent-browser',
      tool_input: { command: 'open https://example.com' },
      risk_class: 'write',
      actor_id: 'user_1',
    });
    expect(core_mocks.update_tool_call_finished).toHaveBeenCalledWith(stub_db, {
      tool_call_id: 'tc_1',
      tool_status: 'completed',
      output_text: 'Done',
      duration_ms: expect.any(Number),
      actor_id: 'user_1',
    });
  });

  it('opens the live dashboard after the subagent completes its first browser action', async () => {
    const input = remote_sandbox_input();
    const start_preview = vi.mocked(input.environment?.start_preview);
    const [browse] = create_browser_tool_definitions(stub_db, input, 'subagent', scripted_engine());

    await browse?.execute?.({ task: 'do a web task' }, { run_key: 'run_1', metadata: {} });

    await vi.waitFor(() => expect(start_preview).toHaveBeenCalledOnce());
  });

  it('threads the configured command budget into the sub-agent loop', async () => {
    const relentless_engine: RuntimeAgentEngine = {
      engine_name: 'relentless',
      async *run(input: RuntimeAgentEngineInput) {
        let call_index = 0;
        while (!input.signal.aborted) {
          call_index += 1;
          yield {
            type: 'message' as const,
            message: {
              role: 'assistant' as const,
              content: [
                {
                  type: 'tool_call' as const,
                  id: `call_${call_index}`,
                  name: 'browser',
                  arguments: { command: 'snapshot -i' },
                },
              ],
            },
          };
          const tool = input.tools[0];
          if (!tool?.execute) throw new Error('no executable browser tool');
          await tool.execute(
            { command: 'snapshot -i' },
            { run_key: input.run_key, tool_call_id: `call_${call_index}`, metadata: {} },
          );
        }
      },
    };
    const [browse] = create_browser_tool_definitions(
      stub_db,
      remote_sandbox_input(),
      'subagent',
      relentless_engine,
    );
    const result = await browse?.execute?.(
      { task: 'never finishes' },
      { run_key: 'run_1', metadata: {} },
    );
    expect(result).toMatchObject({ ok: false, error_code: 'browser_step_budget_exhausted' });
    expect(core_mocks.create_tool_call_started).toHaveBeenCalledTimes(
      resolve_browser_max_steps() + 1,
    );
    expect(core_mocks.update_run_status).toHaveBeenLastCalledWith(stub_db, {
      run_id: 'run_child',
      run_status: 'failed',
      error_message: expect.stringContaining('all 150 browser commands'),
      actor_id: 'user_1',
    });
  });

  it('marks the child run failed when the engine fails', async () => {
    const broken_engine: RuntimeAgentEngine = {
      engine_name: 'broken',
      // biome-ignore lint/correctness/useYield: this engine fails before yielding
      async *run() {
        throw new Error('No API key configured for anthropic');
      },
    };
    const [browse] = create_browser_tool_definitions(
      stub_db,
      remote_sandbox_input(),
      'subagent',
      broken_engine,
    );
    const result = await browse?.execute?.(
      { task: 'do a web task' },
      { run_key: 'run_1', metadata: {} },
    );
    expect(result).toMatchObject({ ok: false, error_code: 'browser_unavailable' });
    expect(core_mocks.update_run_status).toHaveBeenLastCalledWith(stub_db, {
      run_id: 'run_child',
      run_status: 'failed',
      error_message: 'No API key configured for anthropic',
      actor_id: 'user_1',
    });
  });

  it('marks the child run failed when the browser skill prompt cannot load', async () => {
    const input: BrowserToolAssemblyInput = {
      ...remote_sandbox_input(),
      environment: {
        env_key: 'sandbox_1',
        env_kind: 'remote_sandbox',
        metadata: { provider_sandbox_id: 'sandbox_1' },
        exec: () => Promise.resolve({ exit_code: 1, stdout: '', stderr: 'missing skill' }),
      },
    };
    const [browse] = create_browser_tool_definitions(stub_db, input, 'subagent', scripted_engine());
    const result = await browse?.execute?.(
      { task: 'do a web task' },
      { run_key: 'run_1', metadata: {} },
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'browser_unavailable',
      error_message: expect.stringContaining('missing skill'),
    });
    expect(core_mocks.update_run_status).toHaveBeenLastCalledWith(stub_db, {
      run_id: 'run_child',
      run_status: 'failed',
      error_message: expect.stringContaining('missing skill'),
      actor_id: 'user_1',
    });
  });
});
