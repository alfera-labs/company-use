import type { LlmResolvedRequest } from '@agent-core/llm_gateway';
import type { RuntimeAgentEngine } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const title_gateway_requests = vi.hoisted(
  () =>
    [] as Array<{ use_case: string; session_id?: string; run_id?: string; prompt_text: string }>,
);
const agent_engine_models = vi.hoisted(
  () =>
    [] as Array<{
      model_provider: string;
      model_proxy?: string;
      model_name: string;
    }>,
);

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/test',
    async *run(input) {
      agent_engine_models.push({ ...input.model });
      const latest_user_text = [...input.messages]
        .reverse()
        .find((message) => message.role === 'user')
        ?.content.filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

      if (latest_user_text === 'Wait for cancellation') {
        while (!input.signal.aborted) await wait_for_milliseconds(5);
        return;
      }

      if (latest_user_text === 'Emit hidden tool call') {
        yield {
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '', signature: '{"id":"rs_tool"}' },
              {
                type: 'tool_call',
                id: 'call_hidden',
                name: 'runtime-search_tools-1',
                arguments: { query: 'gmail tools available' },
              },
            ],
          },
        };
        return;
      }

      if (latest_user_text === 'Emit hidden reasoning tool call') {
        yield {
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'Searching Gmail before calling the tool.',
                signature: '{"id":"rs_reasoning_tool"}',
              },
              {
                type: 'tool_call',
                id: 'call_reasoning_hidden',
                name: 'runtime-search_tools-1',
                arguments: { query: 'gmail tools available' },
              },
            ],
          },
        };
        return;
      }

      if (
        latest_user_text === 'Use the saved model route' ||
        latest_user_text === 'Use the selected message route'
      ) {
        yield {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Used the requested model route.' }],
          },
        };
        return;
      }

      const search_context_tool = input.tools.find(
        (tool) => tool.tool_name === 'runtime-search_context-1',
      );

      await search_context_tool?.execute?.(
        { query: 'Check this account list' },
        {
          run_key: input.run_key,
          ...(input.session_key === undefined ? {} : { session_key: input.session_key }),
          tool_call_id: 'pi_tool_call_test',
          metadata: input.metadata,
        },
      );

      yield {
        type: 'progress',
        label: 'pi.thinking_start',
        content_index: 0,
        metadata: { provider: input.model.model_provider, model: input.model.model_name },
      };
      yield {
        type: 'progress',
        label: 'pi.thinking_delta',
        delta: 'Inspecting the request.',
        content_index: 0,
        metadata: { provider: input.model.model_provider, model: input.model.model_name },
      };
      yield {
        type: 'progress',
        label: 'pi.thinking_end',
        content: 'Inspecting the request.',
        content_index: 0,
        metadata: { provider: input.model.model_provider, model: input.model.model_name },
      };
      yield {
        type: 'message_delta',
        delta: 'Checked ',
        accumulated_text: 'Checked ',
      };
      yield {
        type: 'message_delta',
        delta: 'the account list.',
        accumulated_text: 'Checked the account list.',
      };
      yield {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: '',
              signature: '{"id":"rs_test","type":"reasoning","summary":[]}',
            },
            {
              type: 'text',
              text: 'Checked the account list.',
              text_signature: '{"id":"msg_test","phase":"final_answer"}',
            },
          ],
          metadata: {
            usage: {
              input: 12,
              output: 8,
              cacheRead: 2,
              cacheWrite: 0,
              totalTokens: 22,
              cost: {
                input: 0.001,
                output: 0.002,
                cacheRead: 0.0001,
                cacheWrite: 0,
                total: 0.0031,
              },
            },
          },
        },
      };
    },
  }),
}));

vi.mock('@agent-core/llm_gateway/adapters/pi_ai_adapter', () => ({
  create_pi_ai_adapter: () => ({
    async generate_text(input: LlmResolvedRequest) {
      title_gateway_requests.push({
        use_case: input.use_case,
        ...(input.session_id === undefined ? {} : { session_id: input.session_id }),
        ...(input.run_id === undefined ? {} : { run_id: input.run_id }),
        prompt_text: input.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
      });
      const text = '{"title":"Inbox Follow Up Audit"}';
      return {
        text,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          metadata: {
            provider: input.model.model_provider,
            model: input.model.model_name,
            fake: true,
          },
        },
        model: {
          model_provider: input.model.model_provider,
          model_proxy: input.model.model_proxy,
          model_name: input.model.model_name,
        },
        metadata: { fake: true },
      };
    },
    async *stream() {},
  }),
}));

afterEach(() => {
  title_gateway_requests.length = 0;
  agent_engine_models.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stub_session_test_env() {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test_anthropic_key');
  vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'local');
}

function clear_model_provider_env() {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('ANTHROPIC_OAUTH_TOKEN', '');
}

async function create_seeded_test_database() {
  const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
  const { seed_native_catalogs } = await import('@coworker/runtime-platform');
  const db = await create_test_database();
  await seed_native_catalogs(db);
  return db;
}

async function use_in_memory_file_storage() {
  const { create_in_memory_object_storage, set_memory_import_object_storage_for_tests } =
    await import('@coworker/runtime-platform');
  set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
}

describe('api app', () => {
  it('deletes a chat from the listing without destroying its row', async () => {
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);

    const created = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Delete me' }),
    });
    const session = (await created.json()).data;

    const deleted = await app.request(`/v1/sessions/${session.session_id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).data.session_status).toBe('deleted');

    const listed = (await (await app.request('/v1/sessions')).json()).data as {
      session_id: string;
    }[];
    expect(listed.some((row) => row.session_id === session.session_id)).toBe(false);

    const fetched = await app.request(`/v1/sessions/${session.session_id}`);
    expect(fetched.status).toBe(200);

    const missing = await app.request('/v1/sessions/ses_does_not_exist', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  }, 30_000);

  it('deletes a running chat, and the deleted chat takes no new run', async () => {
    const { create_app } = await import('@api/app');
    const { acquire_session_execution_lock, get_session } = await import(
      '@coworker/core/db/queries/sessions'
    );
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Still running' }),
    });
    const session = (await created.json()).data;
    await acquire_session_execution_lock(db, {
      workspace_id: session.workspace_id,
      session_id: session.session_id,
      run_id: 'run_locked',
      lease_ms: 60_000,
      actor_id: session.created_by,
    });

    const deleted = await app.request(`/v1/sessions/${session.session_id}`, { method: 'DELETE' });

    expect(deleted.status).toBe(200);
    const stored = await get_session(db, session.workspace_id, session.session_id);
    expect(stored?.session_status).toBe('deleted');
    expect(
      await acquire_session_execution_lock(db, {
        workspace_id: session.workspace_id,
        session_id: session.session_id,
        run_id: 'run_after_delete',
        lease_ms: 60_000,
        actor_id: session.created_by,
      }),
    ).toBeNull();
  }, 30_000);

  it('exposes health without database bootstrap', async () => {
    const { create_app } = await import('@api/app');
    const app = create_app({} as never);
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: 'ok' } });
  });

  it('runs a saved Gateway default through its proxy while preserving the model provider', async () => {
    vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'local');
    clear_model_provider_env();
    vi.stubEnv('VERCEL_AI_GATEWAY_API_KEY', 'test_gateway_key');
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          anthropic: { id: 'anthropic', name: 'Anthropic', models: {} },
          vercel: {
            id: 'vercel',
            name: 'Vercel',
            models: {
              'anthropic/claude-opus-4.8': {
                id: 'anthropic/claude-opus-4.8',
                name: 'Claude Opus 4.8',
                tool_call: true,
                modalities: { input: ['text'], output: ['text'] },
                limit: { context: 200_000, output: 32_000 },
              },
            },
          },
        }),
      ),
    );
    const { create_app } = await import('@api/app');
    const { get_agent } = await import('@coworker/core/db/queries/sessions');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Saved model route' }),
    });
    const session = (await session_response.json()).data;

    const agent_response = await app.request(`/v1/agents/${session.agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_model: {
          model_provider: 'anthropic',
          model_proxy: 'vercel_ai_gateway',
          model_name: 'anthropic/claude-opus-4.8',
        },
      }),
    });
    const run_response = await app.request(`/v1/sessions/${session.session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Use the saved model route' }),
    });
    const selected_run_response = await app.request(`/v1/sessions/${session.session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Use the selected message route',
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
      }),
    });
    const updated_agent = (await agent_response.json()).data;

    expect(session_response.status).toBe(201);
    expect(agent_response.status).toBe(200);
    expect(run_response.status).toBe(201);
    expect(selected_run_response.status).toBe(201);
    expect(updated_agent.default_model_route).toEqual({
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
    expect(await get_agent(db, session.workspace_id, session.agent_id)).toMatchObject({
      default_model_provider: 'anthropic',
      default_model_name: 'anthropic/claude-opus-4.8',
      agent_config: { model_proxy: 'vercel_ai_gateway' },
    });
    expect(agent_engine_models.slice(-2)).toEqual([
      expect.objectContaining({
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
      expect.objectContaining({
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
      }),
    ]);
  });

  it('does not proxy preview ports that are not registered on the runtime environment', async () => {
    const { create_app } = await import('@api/app');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_runtime_environment, create_session } = await import(
      '@coworker/core/db/queries/sessions'
    );
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Preview auth test',
      actor_id: bootstrap.user_id,
    });
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_test',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview: { port: 3000, command: 'pnpm dev', ready_path: '/' },
        active_preview_ports: [3000],
        active_previews: {
          '3000': { port: 3000, command: 'pnpm dev', ready_path: '/' },
        },
      },
      actor_id: bootstrap.user_id,
    });

    const response = await app.request(
      `/v1/runtime-environments/${runtime_environment.runtime_environment_id}/preview/22`,
    );

    expect(response.status).toBe(404);
  });

  it('runs the first session message path through the real Hono app', async () => {
    stub_session_test_env();
    vi.stubEnv('SANDBOX_PREVIEW_BASE_DOMAIN', 'previews.example.test');
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const { runtime_environments } = await import('@coworker/core/db/schema');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'API test' }),
    });
    const created_session = await created_session_response.json();
    const session_id = created_session.data.session_id;
    await db.insert(runtime_environments).values({
      runtime_environment_id: 'renv_api_preview',
      workspace_id: created_session.data.workspace_id,
      agent_id: created_session.data.agent_id,
      session_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'API Sandbox',
      environment_config: {
        project_description: 'API Sandbox',
      },
      environment_metadata: {
        active_preview_ports: [3000],
        active_previews: { '3000': { port: 3000 } },
      },
      created_by: 'test',
      last_updated_by: 'test',
    });

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Check this account list' }),
    });
    const run = (await run_response.json()).data;
    const messages_response = await app.request(`/v1/sessions/${session_id}/messages`);
    const events_response = await app.request(`/v1/runs/${run.run_id}/events`);
    const chat_stream_events_response = await app.request(
      `/v1/runs/${run.run_id}/chat-stream-events`,
    );
    const inspection_response = await app.request(`/v1/runs/${run.run_id}/inspect`);
    const tool_calls_response = await app.request(`/v1/runs/${run.run_id}/tool-calls`);
    const previews_response = await app.request(`/v1/sessions/${session_id}/sandbox-previews`);
    const tool_calls = (await tool_calls_response.json()).data;
    const linked_events_response = await app.request(
      `/v1/runs/${run.run_id}/events?tool_call_id=${tool_calls[0].tool_call_id}`,
    );
    const tool_call_response = await app.request(`/v1/tool-calls/${tool_calls[0].tool_call_id}`);
    const cancel_response = await app.request(`/v1/runs/${run.run_id}/cancel`, {
      method: 'POST',
    });
    const sessions_response = await app.request('/v1/sessions');
    const inspection = (await inspection_response.json()).data;

    expect(created_session_response.status).toBe(201);
    expect(run_response.status).toBe(201);
    const messages = (await messages_response.json()).data.items;
    expect(messages.map((message: { message_role: string }) => message.message_role)).toEqual([
      'user',
      'tool_result',
      'assistant',
    ]);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message_role: 'assistant',
          source_metadata: expect.objectContaining({
            has_visible_text: true,
            provider_metadata: expect.objectContaining({
              usage: expect.any(Object),
            }),
          }),
          message_content: {
            type: 'text',
            text: 'Checked the account list.',
            parts: [
              {
                type: 'thinking',
                thinking: '',
                signature: '{"id":"rs_test","type":"reasoning","summary":[]}',
                signature_data: { id: 'rs_test', type: 'reasoning', summary: [] },
              },
              {
                type: 'text',
                text: 'Checked the account list.',
                text_signature: '{"id":"msg_test","phase":"final_answer"}',
                text_signature_data: { id: 'msg_test', phase: 'final_answer' },
              },
            ],
          },
        }),
        expect.objectContaining({
          message_role: 'tool_result',
          tool_call_id: tool_calls[0].tool_call_id,
          message_content: expect.objectContaining({
            type: 'tool_result',
            data: expect.objectContaining({
              tool_name: 'runtime-search_context-1',
            }),
          }),
        }),
      ]),
    );
    const events = (await events_response.json()).data;
    const chat_stream_events = (await chat_stream_events_response.json()).data;

    const paged_response = await app.request(`/v1/sessions/${session_id}/messages?limit=2`);
    const paged = (await paged_response.json()).data;
    expect(paged.items.map((m: { message_role: string }) => m.message_role)).toEqual([
      'tool_result',
      'assistant',
    ]);
    expect(paged.next_cursor).toBe(paged.items[0].message_sequence);
    const earlier_response = await app.request(
      `/v1/sessions/${session_id}/messages?before_sequence=${paged.next_cursor}`,
    );
    const earlier = (await earlier_response.json()).data;
    expect(earlier.items.map((m: { message_role: string }) => m.message_role)).toEqual(['user']);
    expect(earlier.next_cursor).toBeNull();
    const single_message_response = await app.request(
      `/v1/sessions/${session_id}/messages/${paged.items[0].run_message_id}`,
    );
    expect(single_message_response.status).toBe(200);
    expect((await single_message_response.json()).data.run_message_id).toBe(
      paged.items[0].run_message_id,
    );
    const limited_events_response = await app.request(
      `/v1/runs/${run.run_id}/chat-stream-events?limit=1`,
    );
    const limited_events = (await limited_events_response.json()).data;
    expect(limited_events).toHaveLength(1);
    expect(limited_events[0].sequence).toBe(chat_stream_events[0].sequence);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run_id: run.run_id,
          event_type: 'start',
          event_data: expect.not.objectContaining({ metadata: expect.anything() }),
          event_metadata: expect.objectContaining({
            agent_id: expect.any(String),
            workspace_id: expect.any(String),
            context_management: expect.any(Object),
          }),
        }),
        expect.objectContaining({ run_id: run.run_id, event_type: 'message' }),
        expect.objectContaining({ run_id: run.run_id, event_type: 'end' }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event_label: 'pi.thinking_delta' })]),
    );
    expect(chat_stream_events_response.status).toBe(200);
    expect(chat_stream_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'item_started',
          item: expect.objectContaining({
            item_type: 'thinking',
          }),
        }),
        expect.objectContaining({
          event_type: 'item_completed',
          item: expect.objectContaining({
            item_type: 'thinking',
            text: 'Inspecting the request.',
          }),
        }),
        expect.objectContaining({
          event_type: 'item_completed',
          item: expect.objectContaining({
            item_type: 'tool_call',
            tool_call_id: tool_calls[0].tool_call_id,
          }),
        }),
      ]),
    );
    expect(chat_stream_events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event_type: 'item_delta' })]),
    );
    const replay_after_first_response = await app.request(
      `/v1/runs/${run.run_id}/chat-stream-events?after_sequence=${chat_stream_events[0].sequence}`,
    );
    const replay_after_first = (await replay_after_first_response.json()).data;
    expect(
      replay_after_first.every(
        (event: { sequence: number }) => event.sequence > chat_stream_events[0].sequence,
      ),
    ).toBe(true);
    expect(inspection).toEqual({
      run: expect.objectContaining({
        run_id: run.run_id,
        total_run_ms: expect.any(Number),
        db_write_total_ms: expect.any(Number),
      }),
      messages: expect.arrayContaining([
        expect.objectContaining({ run_id: run.run_id, message_role: 'user' }),
        expect.objectContaining({ run_id: run.run_id, message_role: 'tool_result' }),
        expect.objectContaining({ run_id: run.run_id, message_role: 'assistant' }),
      ]),
      events: expect.arrayContaining([
        expect.objectContaining({ run_id: run.run_id, event_type: 'start' }),
        expect.objectContaining({
          run_id: run.run_id,
          tool_call_id: tool_calls[0].tool_call_id,
          event_label: 'tool_call.started',
        }),
        expect.objectContaining({
          run_id: run.run_id,
          tool_call_id: tool_calls[0].tool_call_id,
          event_label: 'tool_call.completed',
        }),
      ]),
      tool_calls: expect.arrayContaining([
        expect.objectContaining({
          run_id: run.run_id,
          tool_name: 'runtime-search_context-1',
          risk_class: 'read',
          approval_mode: 'auto',
        }),
      ]),
      model_context_snapshots: expect.arrayContaining([
        expect.objectContaining({
          run_id: run.run_id,
          snapshot_kind: 'engine_input',
          message_count: 3,
        }),
      ]),
      files: [],
      artifacts: [],
      audit: expect.any(Object),
    });
    expect(inspection.run.total_run_ms).toBeGreaterThan(0);
    expect(inspection.run.db_write_total_ms).toBeGreaterThan(0);
    expect(tool_calls_response.status).toBe(200);
    await expect(previews_response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          runtime_environment_id: 'renv_api_preview',
          preview_url: expect.stringMatching(
            /^https:\/\/api-sandbox-[a-f0-9]{8}\.previews\.example\.test$/u,
          ),
          source: 'active',
        }),
      ],
    });
    expect(tool_calls).toEqual([
      expect.objectContaining({
        run_id: run.run_id,
        tool_name: 'runtime-search_context-1',
        tool_status: 'completed',
      }),
    ]);
    await expect(linked_events_response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          tool_call_id: tool_calls[0].tool_call_id,
          event_label: 'tool_call.started',
        }),
        expect.objectContaining({
          tool_call_id: tool_calls[0].tool_call_id,
          event_label: 'tool_call.completed',
        }),
      ],
    });
    expect(await tool_call_response.json()).toEqual({
      data: expect.objectContaining({
        tool_call_id: tool_calls[0].tool_call_id,
        run_id: run.run_id,
      }),
    });
    expect(await cancel_response.json()).toEqual({
      data: expect.objectContaining({ run_id: run.run_id, run_status: 'completed' }),
    });
    expect(run).toMatchObject({
      input_tokens: 12,
      output_tokens: 8,
      cache_read_tokens: 2,
      usage_metadata: { billing: { provider_cost_microcents: 310_000 } },
    });
    expect(run.cost_microcents).toBe(run.usage_metadata.billing.billable_cost_microcents);
    const sessions = (await sessions_response.json()).data;
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id,
          last_message_preview: 'Checked the account list.',
        }),
      ]),
    );
  });

  it('generates a proper session title from the first API prompt', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const { get_session } = await import('@coworker/core/db/queries/sessions');
    const db = await create_seeded_test_database();
    const app = create_app(db);

    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created_session = (await created_session_response.json()).data;
    const run_response = await app.request(`/v1/sessions/${created_session.session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Search my emails and find unanswered threads' }),
    });
    const run = (await run_response.json()).data;
    const session = await get_session(db, created_session.workspace_id, created_session.session_id);

    expect(run_response.status).toBe(201);
    expect(run.run_id).toMatch(/^run_/u);
    expect(title_gateway_requests).toEqual([
      {
        use_case: 'session_title',
        session_id: created_session.session_id,
        prompt_text: expect.stringContaining('Search my emails and find unanswered threads'),
      },
    ]);
    expect(session?.session_title).toBe('Inbox Follow Up Audit');

    const second_run_response = await app.request(
      `/v1/sessions/${created_session.session_id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Send a follow-up summary' }),
      },
    );
    const session_after_second_run = await get_session(
      db,
      created_session.workspace_id,
      created_session.session_id,
    );

    expect(second_run_response.status).toBe(201);
    expect(title_gateway_requests).toEqual([
      {
        use_case: 'session_title',
        session_id: created_session.session_id,
        prompt_text: expect.stringContaining('Search my emails and find unanswered threads'),
      },
    ]);
    expect(session_after_second_run?.session_title).toBe('Inbox Follow Up Audit');
  });

  it('returns a structured error when requested model provider credentials are missing', async () => {
    vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'local');
    clear_model_provider_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);

    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Gateway config test' }),
    });
    const created_session = (await created_session_response.json()).data;
    const run_response = await app.request(`/v1/sessions/${created_session.session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Use the gateway model',
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-4.6',
      }),
    });

    expect(run_response.status).toBe(500);
    await expect(run_response.json()).resolves.toEqual({
      error: {
        code: 'model_proxy_not_configured',
        message:
          'No API key configured for model proxy: vercel_ai_gateway. Set VERCEL_AI_GATEWAY_API_KEY.',
        details: {
          model_proxy: 'vercel_ai_gateway',
          credential_env_names: ['VERCEL_AI_GATEWAY_API_KEY'],
        },
      },
    });
  });

  it('rejects incomplete, unknown, incoherent, and oversized routes before starting a run', async () => {
    stub_session_test_env();
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const app = create_app(await create_seeded_test_database());
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Model route rejection' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;
    const run_count_before = agent_engine_models.length;

    const requests = [
      {
        model_provider: 'openai',
        model_proxy: 'openai_direct',
      },
      {
        model_provider: 'openai',
        model_proxy: 'unknown_proxy',
        model_name: 'gpt-5.5',
      },
      {
        model_provider: 'anthropic',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      },
      {
        model_provider: 'p'.repeat(81),
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      },
      {
        model_provider: 'openai',
        model_proxy: 'p'.repeat(81),
        model_name: 'gpt-5.5',
      },
      {
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'm'.repeat(201),
      },
    ];
    const responses = await Promise.all(
      requests.map((route) =>
        app.request(`/v1/sessions/${session_id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Reject this route', ...route }),
        }),
      ),
    );
    const errors = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([422, 422, 422, 422, 422, 422]);
    expect(errors[0].error.details.fieldErrors.model_name).toEqual([
      'A model route must identify its model.',
    ]);
    expect(errors[1].error.details.fieldErrors.model_proxy).toEqual([
      'Unknown model proxy: unknown_proxy.',
    ]);
    expect(errors[2].error.details.fieldErrors.model_provider).toEqual([
      'Model provider anthropic does not match model gpt-5.5.',
    ]);
    expect(errors[3].error.details.fieldErrors.model_provider).toBeDefined();
    expect(errors[4].error.details.fieldErrors.model_proxy).toBeDefined();
    expect(errors[5].error.details.fieldErrors.model_name).toBeDefined();
    expect(agent_engine_models).toHaveLength(run_count_before);
  });

  it('accepts image content and reasoning overrides in session messages', async () => {
    stub_session_test_env();
    vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
    vi.resetModules();
    const { create_app } = await import('@api/app');
    await use_in_memory_file_storage();
    const image_data = Buffer.from('not a real png, but real bytes').toString('base64');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Vision test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Describe this chart',
        images: [{ data: image_data, mime_type: 'image/png' }],
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.4-mini',
        reasoning_level: 'medium',
        max_output_tokens: 1200,
      }),
    });
    const run = (await run_response.json()).data;
    const messages_response = await app.request(`/v1/sessions/${session_id}/messages`);
    const inspect_response = await app.request(`/v1/runs/${run.run_id}/inspect`);
    const messages = (await messages_response.json()).data.items;
    const inspect = (await inspect_response.json()).data;

    expect(run_response.status).toBe(201);
    expect(messages[0]).toMatchObject({
      message_role: 'user',
      message_content: {
        type: 'multimodal',
        text: 'Describe this chart\nimage-2.png',
        parts: [
          { type: 'text', text: 'Describe this chart' },
          { type: 'image', data: image_data, mime_type: 'image/png' },
          {
            type: 'file',
            name: 'image-2.png',
            mime_type: 'image/png',
            path: expect.stringMatching(
              /^tmp\/attachments\/inline-image-run_\w+-2\/image-2\.png$/u,
            ),
          },
        ],
      },
    });
    expect(messages[0].message_content.parts[2]).not.toHaveProperty('file_id');
    expect(inspect.model_context_snapshots[0].snapshot.model).toMatchObject({
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.4-mini',
      reasoning_level: 'medium',
      max_output_tokens: 1200,
    });
  });

  it('hides assistant tool-call packets without visible text from user-visible chat', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Hidden tool call test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Emit hidden tool call' }),
    });
    const run = (await run_response.json()).data;
    const inspect_response = await app.request(`/v1/runs/${run.run_id}/inspect`);
    const inspect = (await inspect_response.json()).data;

    expect(inspect.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message_role: 'assistant',
          is_user_visible: false,
          is_model_visible: true,
          source_metadata: expect.objectContaining({ has_visible_text: false }),
          message_content: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: 'tool_call', name: 'runtime-search_tools-1' }),
            ]),
          }),
        }),
      ]),
    );
  });

  it('keeps assistant thinking-with-tool-call model-visible, not a reasoning summary', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Hidden reasoning test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Emit hidden reasoning tool call' }),
    });
    const run = (await run_response.json()).data;
    const inspect_response = await app.request(`/v1/runs/${run.run_id}/inspect`);
    const inspect = (await inspect_response.json()).data;

    const reasoned_call = inspect.messages.find(
      (message: { message_role: string; message_content: { parts?: { type: string }[] } }) =>
        message.message_role === 'assistant' &&
        (message.message_content.parts ?? []).some((part) => part.type === 'tool_call'),
    );
    expect(reasoned_call).toMatchObject({
      message_role: 'assistant',
      message_kind: 'output',
      is_model_visible: true,
      is_user_visible: false,
      source_metadata: expect.objectContaining({ has_visible_text: false }),
      message_content: expect.objectContaining({
        type: 'text',
        parts: expect.arrayContaining([
          expect.objectContaining({
            type: 'thinking',
            thinking: 'Searching Gmail before calling the tool.',
          }),
          expect.objectContaining({ type: 'tool_call', name: 'runtime-search_tools-1' }),
        ]),
      }),
    });
    expect(reasoned_call.message_content).not.toHaveProperty('text');
  });

  it('keeps earlier uploaded images in later model context', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    await use_in_memory_file_storage();
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Vision followup test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;
    const image_data = 'a'.repeat(80_000);

    await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Start with text only' }),
    });
    await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Use this image for follow-up questions',
        images: [{ data: image_data, mime_type: 'image/png', source: 'photo.png' }],
      }),
    });
    const followup_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What brand is visible in the image?' }),
    });
    const followup_run = (await followup_response.json()).data;
    const inspect_response = await app.request(`/v1/runs/${followup_run.run_id}/inspect`);
    const inspect = (await inspect_response.json()).data;
    const snapshot_messages = inspect.model_context_snapshots[0].snapshot.engine_input.messages;

    expect(snapshot_messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            {
              type: 'image',
              data: image_data,
              mime_type: 'image/png',
              source: 'photo.png',
            },
          ]),
        }),
      ]),
    );
  });

  it('accepts session messages over the old 8000 character limit', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Long message test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;
    const long_message = 'x'.repeat(8001);

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: long_message }),
    });

    expect(run_response.status).toBe(201);
    await expect(run_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_status: 'completed' }),
    });
  });

  it('cancels an active agent run through the runtime abort path', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const { get_session } = await import('@coworker/core/db/queries/sessions');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created_session = (await created_session_response.json()).data;
    const session_id = created_session.session_id;

    const run_response_promise = app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Wait for cancellation' }),
    });
    const run_id = await wait_for_active_run_id(app, session_id);
    const session_before_cancel = await get_session(
      db,
      created_session.workspace_id,
      created_session.session_id,
    );
    const cancel_response = await app.request(`/v1/runs/${run_id}/cancel`, { method: 'POST' });
    const run_response = await run_response_promise;
    const run_status_response = await app.request(`/v1/runs/${run_id}`);

    expect(session_before_cancel?.session_title).toBe('Inbox Follow Up Audit');
    await expect(cancel_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_id, run_status: 'cancelled' }),
    });
    await expect(run_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_id, run_status: 'cancelled' }),
    });
    await expect(run_status_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_id, run_status: 'cancelled' }),
    });
  });

  it('queues a second message behind the running one, pauses it on stop, and runs it on resume', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const created_session = (await created_session_response.json()).data;
    const session_id = created_session.session_id;

    const first_run_response_promise = app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Wait for cancellation' }),
    });
    const active_run_id = await wait_for_active_run_id(app, session_id);

    const second_run_response_promise = app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Second submit while first is running' }),
    });
    const queued = await wait_for_queued_messages(app, session_id, 1);
    expect(queued).toEqual([
      expect.objectContaining({
        preview_text: 'Second submit while first is running',
        state: 'queued',
        waiting_reason: 'session_busy',
      }),
    ]);

    const cancel_response = await app.request(`/v1/runs/${active_run_id}/cancel`, {
      method: 'POST',
    });
    expect(cancel_response.status).toBe(200);
    const first_run_response = await first_run_response_promise;
    await expect(first_run_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_id: active_run_id, run_status: 'cancelled' }),
    });
    const paused = await wait_for_queued_messages(app, session_id, 1);
    expect(paused).toEqual([
      expect.objectContaining({ state: 'paused', waiting_reason: 'paused' }),
    ]);
    const runs_while_paused = (await (await app.request(`/v1/sessions/${session_id}/runs`)).json())
      .data as Array<{ run_id: string }>;
    expect(runs_while_paused).toHaveLength(1);

    const resume_response = await app.request(`/v1/sessions/${session_id}/queued-messages/resume`, {
      method: 'POST',
    });
    expect(resume_response.status).toBe(200);
    const second_run_response = await second_run_response_promise;
    expect(second_run_response.status).toBe(201);
    await expect(second_run_response.json()).resolves.toEqual({
      data: expect.objectContaining({ run_status: 'completed' }),
    });
    const runs = (await (await app.request(`/v1/sessions/${session_id}/runs`)).json())
      .data as Array<{ run_status: string }>;
    expect(runs.map((run) => run.run_status).sort()).toEqual(['cancelled', 'completed']);
    expect(runs.some((run) => run.run_status === 'failed')).toBe(false);
  }, 30_000);

  it('streams session message deltas as server-sent events', async () => {
    stub_session_test_env();
    vi.resetModules();
    const { create_app } = await import('@api/app');
    const db = await create_seeded_test_database();
    const app = create_app(db);
    const created_session_response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'SSE test' }),
    });
    const session_id = (await created_session_response.json()).data.session_id;

    const stream_response = await app.request(`/v1/sessions/${session_id}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Check this account list' }),
    });
    const stream_body = await stream_response.text();

    expect(stream_response.status).toBe(200);
    expect(stream_response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream_body.indexOf('event: queued')).toBe(0);
    expect(stream_body.indexOf('event: queued')).toBeLessThan(
      stream_body.indexOf('event: run_created'),
    );
    expect(stream_body).toContain('event: chat_event');
    expect(stream_body).toContain('id: run_');
    expect(stream_body).toContain('"item_type":"tool_call"');
    expect(stream_body).toContain('"text":"Inspecting the request."');
    expect(stream_body).toContain('"text":"Checked the account list."');
    expect(stream_body).toContain('event: message_created');
    expect(stream_body).toContain('event: run_updated');
    expect(stream_body.trimEnd().endsWith('event: done\ndata: {"ok":true}')).toBe(true);
  });
});

describe('model context snapshots stored as artifacts', () => {
  it('stores a large engine-input snapshot once and the inspector returns the inline body', async () => {
    const { app, db, storage, session_id } = await create_snapshot_test_app();

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Use the saved model route' }),
    });
    const run = (await run_response.json()).data;
    expect(run_response.status).toBe(201);

    const row = await find_engine_input_snapshot(db, run.run_id);
    const artifact_ref = (row.snapshot as { artifact_ref: { artifact_id: string } }).artifact_ref;
    expect(row.snapshot).toEqual({
      shape: 'context_snapshot_ref_v1',
      artifact_ref: {
        artifact_id: expect.any(String),
        byte_size: expect.any(Number),
        preview: expect.any(String),
      },
    });
    expect(row.snapshot_metadata).toEqual({ source: 'runtime_orchestrator' });
    const artifact = await db.query.files.findFirst({
      where: (table, { eq }) => eq(table.file_id, artifact_ref.artifact_id),
    });
    expect(artifact).toMatchObject({
      file_purpose: 'stored_context_snapshot',
      storage_provider: 'object_store',
      storage_key: `ws/${row.workspace_id}/sha256/${artifact?.checksum_sha256}`,
      is_visible: false,
      run_id: run.run_id,
      session_id,
      source_tool_call_id: null,
    });
    expect(artifact?.byte_size).toBeGreaterThan(32_768);
    const stored_bytes = storage.objects.get(String(artifact?.storage_key))?.data;
    expect(stored_bytes?.byteLength).toBe(artifact?.byte_size);

    const pointer_inspection = await (await app.request(`/v1/runs/${run.run_id}/inspect`)).text();
    const inspection = JSON.parse(pointer_inspection).data;
    expect(inspection.model_context_snapshots[0].snapshot.engine_input).toBeDefined();
    expect(inspection.files.map((file: { file_id: string }) => file.file_id)).not.toContain(
      artifact_ref.artifact_id,
    );

    const { run_model_context_snapshots } = await import('@coworker/core/db/schema');
    const { eq } = await import('drizzle-orm');
    await db
      .update(run_model_context_snapshots)
      .set({ snapshot: JSON.parse(Buffer.from(stored_bytes ?? []).toString('utf8')) })
      .where(
        eq(
          run_model_context_snapshots.run_model_context_snapshot_id,
          row.run_model_context_snapshot_id,
        ),
      );
    const inline_inspection = await (await app.request(`/v1/runs/${run.run_id}/inspect`)).text();
    expect(inline_inspection).toBe(pointer_inspection);
  });

  it('keeps the snapshot inline and finishes the run when object storage refuses it', async () => {
    const { app, db, session_id } = await create_snapshot_test_app({ refuse_writes: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const run_response = await app.request(`/v1/sessions/${session_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Use the saved model route' }),
    });
    const run = (await run_response.json()).data;

    expect(run_response.status).toBe(201);
    expect(run.run_status).toBe('completed');
    const row = await find_engine_input_snapshot(db, run.run_id);
    expect(row.snapshot).toHaveProperty('engine_input');
    expect(row.snapshot).not.toHaveProperty('artifact_ref');
    const stored = await db.query.files.findMany({
      where: (table, { eq }) => eq(table.file_purpose, 'stored_context_snapshot'),
    });
    expect(stored).toEqual([]);
    vi.restoreAllMocks();
  });
});

async function create_snapshot_test_app(options: { refuse_writes?: boolean } = {}) {
  stub_session_test_env();
  vi.resetModules();
  const { create_in_memory_object_storage, set_memory_import_object_storage_for_tests } =
    await import('@coworker/runtime-platform');
  const storage = create_in_memory_object_storage();
  set_memory_import_object_storage_for_tests(
    options.refuse_writes
      ? {
          ...storage,
          put_if_absent: async () => {
            throw new Error('bucket unreachable');
          },
        }
      : storage,
  );
  const { create_app } = await import('@api/app');
  const db = await create_seeded_test_database();
  const app = create_app(db);
  const created_session_response = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_title: 'Snapshot storage test' }),
  });
  const session_id: string = (await created_session_response.json()).data.session_id;
  return { app, db, storage, session_id };
}

async function find_engine_input_snapshot(
  db: Awaited<ReturnType<typeof create_seeded_test_database>>,
  run_id: string,
) {
  const row = await db.query.run_model_context_snapshots.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.run_id, run_id), eq(table.snapshot_kind, 'engine_input')),
  });
  if (!row) throw new Error('engine_input snapshot missing');
  return row;
}

async function wait_for_active_run_id(
  app: { request: (input: string | Request, init?: RequestInit) => Response | Promise<Response> },
  session_id: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.request(`/v1/sessions/${session_id}/runs`);
    const runs = (await response.json()).data as Array<{ run_id: string; run_status: string }>;
    const active_run = runs.find((run) => ['queued', 'running'].includes(run.run_status));
    if (active_run) return active_run.run_id;
    await wait_for_milliseconds(5);
  }

  throw new Error('Timed out waiting for active run');
}

async function wait_for_queued_messages(
  app: { request: (input: string | Request, init?: RequestInit) => Response | Promise<Response> },
  session_id: string,
  count: number,
) {
  let last: Array<{ state: string }> = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.request(`/v1/sessions/${session_id}/queued-messages`);
    last = (await response.json()).data;
    if (last.length === count) return last;
    await wait_for_milliseconds(10);
  }
  throw new Error(`Timed out waiting for ${count} queued messages; saw ${JSON.stringify(last)}`);
}

function wait_for_milliseconds(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
