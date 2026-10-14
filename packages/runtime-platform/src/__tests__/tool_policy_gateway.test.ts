import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionEnvPreviewInput } from '@agent-core/environment';
import { sandbox_preview_base_domain } from '@coworker/config/hosted_defaults';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { update_agent_enabled_nodes } from '@coworker/core/db/queries/connection_management';
import {
  cancel_run,
  create_run,
  create_run_message,
  create_session,
  get_run_cancel_intent,
  get_runtime_environment,
  list_run_events,
  list_run_tool_calls,
  list_session_messages,
  request_run_cancellation,
} from '@coworker/core/db/queries/sessions';
import { open_or_create_coding_workspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { slack_respond_tool } from '@runtime-platform/tools/slack/respond';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

async function with_workspace_base<T>(test: (workspace_base_path: string) => Promise<T>) {
  const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-policy-'));
  try {
    return await test(workspace_base_path);
  } finally {
    await rm(workspace_base_path, { recursive: true, force: true });
  }
}

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Tool policy gateway test',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, session, run };
}

async function open_workspace(
  workspace_base_path: string,
  fixture: Awaited<ReturnType<typeof create_fixture>>,
) {
  return open_or_create_coding_workspace(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.bootstrap.agent_id,
    run_id: fixture.run.run_id,
    provider: 'local',
    workspace_base_path,
    actor_id: fixture.bootstrap.user_id,
  });
}

function tool_definitions(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  workspace: Awaited<ReturnType<typeof open_workspace>>,
) {
  return create_runtime_tool_definitions(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.bootstrap.agent_id,
    runtime_environment_id: workspace.runtime_environment_id,
    environment: workspace.environment,
    actor_id: fixture.bootstrap.user_id,
  });
}

const default_context = {
  run_key: 'run-test',
  session_key: 'session-test',
  metadata: {},
};

describe('tool policy gateway', () => {
  it('exposes Pi-core coding tools through the persisted tool gateway', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));

      expect([...tool_by_name.keys()]).toEqual(
        expect.arrayContaining(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']),
      );

      const write_result = await tool_by_name.get('write')?.execute?.(
        { path: 'notes/pi.txt', content: 'pi core tools' },
        {
          ...default_context,
          tool_call_id: 'call_provider_write_1',
          environment: workspace.environment,
        },
      );

      expect(write_result).toMatchObject({ ok: true });
      const calls = await list_run_tool_calls(
        fixture.db,
        fixture.bootstrap.workspace_id,
        fixture.run.run_id,
      );
      expect(calls).toEqual([
        expect.objectContaining({
          tool_name: 'write',
          tool_status: 'completed',
        }),
      ]);
      const messages = await restore_run_message_tool_results(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        rows: await list_session_messages(
          fixture.db,
          fixture.bootstrap.workspace_id,
          fixture.session.session_id,
        ),
        reading: 'load_full_value',
      });
      expect(messages).toEqual([
        expect.objectContaining({
          message_role: 'tool_result',
          tool_call_id: calls[0]?.tool_call_id,
          message_content: expect.objectContaining({
            type: 'tool_result',
            data: expect.objectContaining({
              tool_name: 'write',
              model_tool_call_id: 'call_provider_write_1',
            }),
            parts: [
              expect.objectContaining({
                type: 'tool_result',
                tool_call_id: 'call_provider_write_1',
                result: expect.objectContaining({ ok: true }),
              }),
            ],
          }),
        }),
      ]);
    });
  });

  it('hides host-bound Pi coding tools for custom workspace environments', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const custom_environment = {
        ...workspace.environment,
        env_kind: 'custom' as const,
        working_directory: '/workspace',
      };
      const tools = create_runtime_tool_definitions(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        session_id: fixture.session.session_id,
        run_id: fixture.run.run_id,
        agent_id: fixture.bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: custom_environment,
        actor_id: fixture.bootstrap.user_id,
      });
      const tool_names = tools.map((tool) => tool.tool_name);

      expect(tool_names).not.toEqual(
        expect.arrayContaining(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']),
      );
      expect(tool_names).toEqual(
        expect.arrayContaining(['workspace-read_file', 'workspace-write_file']),
      );
      expect(tool_names).not.toEqual(expect.arrayContaining(['sandbox-read']));
      expect(tool_names).not.toEqual(expect.arrayContaining(['sandbox-write']));
    });
  });

  it('reports the absolute sandbox path so run_command can act on it without guessing', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));

      const result = await tool_by_name.get('workspace-write_file')?.execute?.(
        { path: 'artifacts/build.py', content: 'print(1)' },
        {
          ...default_context,
          tool_call_id: 'call_write_absolute_path',
          environment: workspace.environment,
        },
      );

      expect(result).toMatchObject({
        ok: true,
        content_text: 'Wrote /workspace/artifacts/build.py',
        metadata: expect.objectContaining({ workspace_path: 'artifacts/build.py' }),
      });
    });
  });

  it('returns sandbox_unavailable when a workspace tool is invoked without an environment', async () => {
    const fixture = await create_fixture();
    const tools = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
    });
    const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
    const result = await tool_by_name
      .get('workspace-write_file')
      ?.execute?.({ path: 'a.txt', content: 'b' }, default_context);
    expect(result).toMatchObject({ ok: false, error_code: 'sandbox_unavailable' });
    const calls = await list_run_tool_calls(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tool_status: 'failed',
      error_code: 'sandbox_unavailable',
    });
  });

  it('searches persisted session context through runtime-search_context-1', async () => {
    const fixture = await create_fixture();
    await create_run_message(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      message_role: 'assistant',
      message_content: {
        type: 'text',
        text: 'The billing migration uses quarterly_discount_percent for quarterly pricing.',
      },
      source_type: 'runtime',
      actor_id: fixture.bootstrap.user_id,
    });
    const tools = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
    });
    const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));

    const result = await tool_by_name
      .get('runtime-search_context-1')
      ?.execute?.({ query: 'quarterly_discount_percent', max_results: 3 }, default_context);

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        result_count: 1,
        results: [
          expect.objectContaining({
            message_role: 'assistant',
            snippet: expect.stringContaining('quarterly_discount_percent'),
          }),
        ],
      },
    });
  });

  it('searches tool catalog and returns full schemas on demand', async () => {
    const fixture = await create_fixture();
    await seed_runtime_tool_catalog(fixture.db);
    await update_agent_enabled_nodes(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      enabled_nodes: [
        {
          node_key: 'slack-send_message-1',
          provider_key: 'native',
          status: 'enabled',
          connection_selector: { strategy: 'latest_active_matching_connection' },
          input_defaults: {},
          approval_policy_override: null,
        },
      ],
    });
    const tools = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
    });
    const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
    const connection_query = vi.spyOn(fixture.db.query.connections, 'findMany');

    const search_result = await tool_by_name
      .get('runtime-search_tools-1')
      ?.execute?.({ query: 'Slack message', max_results: 5 }, default_context);
    const schema_result = await tool_by_name
      .get('runtime-get_tool_schema-1')
      ?.execute?.({ node_key: 'slack-send_message-1' }, default_context);

    expect(search_result).toMatchObject({
      ok: true,
      content_json: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            node_key: 'slack-send_message-1',
            input_fields: expect.arrayContaining([expect.objectContaining({ name: 'channel_id' })]),
          }),
        ]),
      },
    });
    expect(connection_query).toHaveBeenCalledTimes(3);
    expect(schema_result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'slack-send_message-1',
        schema_id: null,
        input_schema: expect.objectContaining({
          required: ['channel_id', 'message'],
        }),
      },
    });
  });

  it('gates slack-respond-1 to Slack turns and keeps the runtime guard as a backstop', async () => {
    const fixture = await create_fixture();
    const dashboard_tools = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
    });
    expect(dashboard_tools.some((tool) => tool.tool_name === 'slack-respond-1')).toBe(false);
    expect(dashboard_tools.some((tool) => tool.tool_name === 'slack-send_message-1')).toBe(true);

    const guarded = await slack_respond_tool.execute(
      { resolution_type: 'reply', message: 'Hello' },
      undefined,
    );
    expect(guarded).toMatchObject({ success: false, error: { code: 'slack_turn_required' } });

    const slack_tools = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: fixture.bootstrap.user_id,
      source_context: {
        source_type: 'slack',
        source_metadata: {
          slack: {
            connection_id: 'conn_slack_test',
            channel_id: 'C123',
            event_ts: '1700000000.000100',
            thread_ts: '1700000000.000100',
            turn_subject_key: 'slack:T123:C123:thread:1700000000.000100',
          },
        },
      },
    });
    const slack_respond = slack_tools.find((tool) => tool.tool_name === 'slack-respond-1');
    expect(slack_respond?.input_schema).toMatchObject({
      type: 'object',
      required: ['resolution_type', 'message'],
      properties: {
        resolution_type: { enum: ['reply'] },
        message: { type: 'string' },
      },
    });
  });

  it('records command_failed with exit_code metadata when a workspace command exits non-zero', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const result = await tool_by_name
        .get('workspace-run_command')
        ?.execute?.({ command: 'sh', args: ['-c', 'exit 2'] }, default_context);
      expect(result).toMatchObject({ ok: false, error_code: 'command_failed' });
      const calls = await list_run_tool_calls(
        fixture.db,
        fixture.bootstrap.workspace_id,
        fixture.run.run_id,
      );
      const failed = calls.find((row) => row.tool_name === 'workspace-run_command');
      expect(failed?.tool_status).toBe('failed');
      expect(failed?.error_code).toBe('command_failed');
    });
  });

  it('runs a shell line passed as the command through a shell instead of execve', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tool_by_name = new Map(
        tool_definitions(fixture, workspace).map((tool) => [tool.tool_name, tool]),
      );

      const result = await tool_by_name
        .get('workspace-run_command')
        ?.execute?.({ command: 'echo shell-line-ok | tr a-z A-Z' }, default_context);

      expect(result).toMatchObject({ ok: true });
      expect(JSON.stringify(result)).toContain('SHELL-LINE-OK');
    });
  });

  it('leaves a plain executable alone when args are supplied', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tool_by_name = new Map(
        tool_definitions(fixture, workspace).map((tool) => [tool.tool_name, tool]),
      );

      const result = await tool_by_name
        .get('workspace-run_command')
        ?.execute?.({ command: 'echo', args: ['plain * exec'] }, default_context);

      expect(result).toMatchObject({ ok: true });
      expect(JSON.stringify(result)).toContain('plain * exec');
    });
  });

  it('records timed_out canonical error when a workspace command exceeds its timeout', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const result = await tool_by_name
        .get('workspace-run_command')
        ?.execute?.({ command: 'sleep', args: ['5'], timeout_ms: 200 }, default_context);
      expect(result).toMatchObject({ ok: false, error_code: 'timed_out' });
      const calls = await list_run_tool_calls(
        fixture.db,
        fixture.bootstrap.workspace_id,
        fixture.run.run_id,
      );
      const timed_out = calls.find((row) => row.error_code === 'timed_out');
      expect(timed_out?.tool_status).toBe('timed_out');
      const events = await list_run_events(
        fixture.db,
        fixture.bootstrap.workspace_id,
        fixture.run.run_id,
      );
      expect(events.some((event) => event.event_label === 'tool_call.timed_out')).toBe(true);
    });
  });

  it('aborts a workspace command that outlives its policy timeout', async () => {
    const fixture = await create_fixture();
    let command_signal: AbortSignal | undefined;
    const run_command = create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.bootstrap.agent_id,
      environment: {
        env_key: 'env_that_never_answers',
        env_kind: 'custom',
        exec: (input) => {
          command_signal = input.signal;
          return new Promise<never>(() => undefined);
        },
      },
      actor_id: fixture.bootstrap.user_id,
    }).find((tool) => tool.tool_name === 'workspace-run_command');
    if (!run_command?.execute) throw new Error('workspace-run_command is not registered.');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let finished = false;
      const running = run_command
        .execute({ command: 'sleep', args: ['60'], timeout_ms: 1_000 }, default_context)
        .finally(() => {
          finished = true;
        });
      while (!finished) await vi.advanceTimersByTimeAsync(1_000);

      expect(await running).toMatchObject({ ok: false, error_code: 'timed_out' });
      expect(command_signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects path escapes through canonical_workspace_path before touching the host fs', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const absolute = await tool_by_name
        .get('workspace-read_file')
        ?.execute?.({ path: '/etc/passwd' }, default_context);
      expect(absolute).toMatchObject({ ok: false });
      const relative = await tool_by_name
        .get('workspace-read_file')
        ?.execute?.({ path: '../escape.txt' }, default_context);
      expect(relative).toMatchObject({ ok: false });
    });
  });

  it('truncates oversized workspace tool output and links a tool_output artifact', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const tools = tool_definitions(fixture, workspace);
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const big = await tool_by_name.get('workspace-run_command')?.execute?.(
        {
          command: 'node',
          args: ['-e', 'process.stdout.write("x".repeat(20000))'],
          timeout_ms: 10_000,
        },
        default_context,
      );
      expect(big).toMatchObject({ ok: true });
      const calls = await list_run_tool_calls(
        fixture.db,
        fixture.bootstrap.workspace_id,
        fixture.run.run_id,
      );
      const truncated = calls.find((row) => row.tool_name === 'workspace-run_command');
      expect(truncated?.output_file_id).toBeTruthy();
    });
  });

  it('starts a sandbox preview and stores the active preview on the runtime environment', async () => {
    await with_workspace_base(async (workspace_base_path) => {
      const fixture = await create_fixture();
      const workspace = await open_workspace(workspace_base_path, fixture);
      const preview_environment = {
        ...workspace.environment,
        start_preview: async (input: SessionEnvPreviewInput) => ({
          port: input.port,
          process_id: 123,
          command: [input.command, ...(input.args ?? [])].join(' '),
          cwd: input.cwd ?? '/workspace',
          ready_url: `http://localhost:${input.port}${input.ready_path ?? '/'}`,
        }),
      };
      const tools = create_runtime_tool_definitions(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        session_id: fixture.session.session_id,
        run_id: fixture.run.run_id,
        agent_id: fixture.bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: preview_environment,
        actor_id: fixture.bootstrap.user_id,
      });
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));

      const result = await tool_by_name.get('workspace-preview')?.execute?.(
        {
          command: 'npm',
          args: ['run', 'dev', '--', '--hostname', '0.0.0.0'],
          port: 5173,
        },
        default_context,
      );

      expect(result?.ok).toBe(true);
      if (!result?.ok) throw new Error('Expected sandbox-preview to succeed.');
      const content_json = result.content_json as { preview_url?: string; port?: number };
      expect(content_json).toMatchObject({
        preview_url: expect.stringContaining(`5173-`),
        port: 5173,
      });
      expect(content_json.preview_url?.startsWith('https://')).toBe(true);
      expect(content_json.preview_url?.endsWith(`.${sandbox_preview_base_domain}`)).toBe(true);
      const runtime_environment = await get_runtime_environment(fixture.db, {
        workspace_id: fixture.bootstrap.workspace_id,
        runtime_environment_id: workspace.runtime_environment_id,
      });
      expect(runtime_environment?.environment_status).toBe('running');
      expect(runtime_environment?.environment_metadata).toMatchObject({
        active_preview_ports: [5173],
        active_preview: {
          port: 5173,
          process_id: 123,
        },
      });
    });
  });
});

describe('cancel intent persistence', () => {
  it('request_run_cancellation persists cancel_requested_time without flipping run_status', async () => {
    const fixture = await create_fixture();
    const before = await get_run_cancel_intent(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
    );
    expect(before?.cancel_requested_time).toBeNull();

    const updated = await request_run_cancellation(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
      fixture.bootstrap.user_id,
    );
    expect(updated.cancel_requested_time).toBeInstanceOf(Date);
    expect(updated.run_status).not.toBe('cancelled');
  });

  it('request_run_cancellation is idempotent: second request preserves the first timestamp', async () => {
    const fixture = await create_fixture();
    const first = await request_run_cancellation(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
      fixture.bootstrap.user_id,
    );
    const first_time = first.cancel_requested_time;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await request_run_cancellation(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
      fixture.bootstrap.user_id,
    );
    expect(second.cancel_requested_time?.getTime()).toBe(first_time?.getTime());
  });

  it('cancel_run flips run_status to cancelled at terminus', async () => {
    const fixture = await create_fixture();
    const cancelled = await cancel_run(
      fixture.db,
      fixture.bootstrap.workspace_id,
      fixture.run.run_id,
      fixture.bootstrap.user_id,
    );
    expect(cancelled.run_status).toBe('cancelled');
  });
});
