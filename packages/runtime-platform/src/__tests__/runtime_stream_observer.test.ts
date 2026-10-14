import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_built_in_tools } from '@agent-core/coding';
import type {
  RuntimeAgentEngine,
  RuntimeAgentEngineEvent,
  RuntimeAgentEngineInput,
} from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_session,
  get_run,
  get_session,
  list_run_messages,
} from '@coworker/core/db/queries/sessions';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime_test_state = vi.hoisted(() => ({
  captured_engine_inputs: [] as RuntimeAgentEngineInput[],
  next_usage: null as null | {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  },
  next_events: null as RuntimeAgentEngineEvent[] | null,
}));

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/stream-observer-test',
    async *run(input) {
      runtime_test_state.captured_engine_inputs.push(input);
      const usage = runtime_test_state.next_usage;
      runtime_test_state.next_usage = null;
      const events = runtime_test_state.next_events;
      runtime_test_state.next_events = null;
      if (events) {
        yield* events;
        return;
      }
      yield {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          ...(usage ? { metadata: { usage } } : {}),
        },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({
    provider: 'openai',
    model_name: 'gpt-test',
    reasoning_level: 'medium',
  }),
}));

describe('runtime stream observers', () => {
  afterEach(() => {
    runtime_test_state.captured_engine_inputs.length = 0;
    runtime_test_state.next_usage = null;
    runtime_test_state.next_events = null;
    vi.restoreAllMocks();
  });

  it('does not fail the run when the stream observer throws', async () => {
    const observer_warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const observed_events: string[] = [];

    const completed_run = await start_agent_run(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        user_message: 'finish this',
        source_type: 'dashboard',
        actor_id: bootstrap.user_id,
        workspace_runtime_provider: 'local',
      },
      {
        on_stream_event: async (event) => {
          observed_events.push(event.type);
          throw new Error('observer stream closed');
        },
      },
    );

    const persisted_run = await get_run(db, bootstrap.workspace_id, completed_run.run_id);
    const persisted_session = await get_session(db, bootstrap.workspace_id, session.session_id);

    expect(completed_run.run_status).toBe('completed');
    expect(persisted_run?.run_status).toBe('completed');
    expect(persisted_run?.error_message).toBeNull();
    expect(persisted_session?.session_status).toBe('completed');
    expect(observed_events).toContain('run_created');
    expect(observed_events).toContain('runtime_event');
    expect(observer_warning).toHaveBeenCalledWith(
      '[runtime_orchestrator] stream observer skipped: "observer stream closed"',
    );
  });

  it('materializes inline file parts into the coding workspace before the model run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-upload-qa-'));

    try {
      const completed_run = await start_agent_run(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        user_content: [
          { type: 'text', text: 'Summarize the upload.' },
          {
            type: 'file',
            name: '../brief.md',
            mime_type: 'text/markdown',
            text: '# Launch\nShip the runtime.',
          },
        ],
        source_type: 'dashboard',
        actor_id: bootstrap.user_id,
        workspace_runtime_provider: 'local',
        workspace_base_path,
      });
      const engine_input = runtime_test_state.captured_engine_inputs.at(-1);
      if (!engine_input) throw new Error('Expected engine input to be captured.');
      if (!engine_input.environment) throw new Error('Expected a local runtime environment.');
      const file_part = engine_input.messages
        .flatMap((message) => message.content)
        .find((part) => part.type === 'file');
      const messages = await list_run_messages(db, bootstrap.workspace_id, completed_run.run_id);
      const persisted_message_content = messages[0]?.message_content as
        | { parts?: Array<{ type: string; path?: string }> }
        | undefined;
      const persisted_file_part = persisted_message_content?.parts?.find(
        (part) => part.type === 'file',
      );
      const canonical_upload_path = `tmp/attachments/inline-text-${completed_run.run_id}-2/brief.md`;
      const upload_path = canonical_upload_path;

      expect(file_part).toMatchObject({
        type: 'file',
        name: '../brief.md',
        path: upload_path,
        text: '# Launch\nShip the runtime.',
      });
      await expect(
        create_built_in_tools()
          .find((tool) => tool.tool_name === 'read')
          ?.execute?.(
            { path: upload_path },
            {
              run_key: completed_run.run_id,
              session_key: session.session_id,
              environment: engine_input.environment,
              metadata: {},
            },
          ),
      ).resolves.toMatchObject({
        ok: true,
        content_text: '# Launch\nShip the runtime.',
      });
      await expect(engine_input.environment.read_file?.(canonical_upload_path)).resolves.toBe(
        '# Launch\nShip the runtime.',
      );
      expect(persisted_file_part).toMatchObject({
        type: 'file',
        path: upload_path,
      });

      const second_run = await start_agent_run(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        user_content: [
          { type: 'text', text: 'Summarize the next upload.' },
          {
            type: 'file',
            name: '../brief.md',
            mime_type: 'text/markdown',
            text: '# Followup\nDo not overwrite the first upload.',
          },
        ],
        source_type: 'dashboard',
        actor_id: bootstrap.user_id,
        workspace_runtime_provider: 'local',
        workspace_base_path,
      });
      const second_engine_input = runtime_test_state.captured_engine_inputs.at(-1);
      if (!second_engine_input?.environment) throw new Error('Expected second engine input.');
      const second_upload_path = `tmp/attachments/inline-text-${second_run.run_id}-2/brief.md`;

      expect(second_upload_path).not.toBe(upload_path);
      await expect(second_engine_input.environment.read_file?.(second_upload_path)).resolves.toBe(
        '# Followup\nDo not overwrite the first upload.',
      );
    } finally {
      await rm(workspace_base_path, { recursive: true, force: true });
    }
  });

  it('persists internal runtime responses without streaming user-visible content', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    runtime_test_state.next_events = [
      {
        type: 'message_delta',
        delta: '{"actions":',
        accumulated_text: '{"actions":',
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '{"actions":[{"type":"no_change","reason":"HEARTBEAT_OK"}]}',
            },
          ],
        },
      },
    ];
    const observed_events: string[] = [];

    const completed_run = await start_agent_run(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        user_message: 'internal scout prompt',
        source_type: 'runtime',
        actor_id: bootstrap.user_id,
        workspace_runtime_provider: 'local',
        user_message_is_user_visible: false,
        runtime_response_is_user_visible: false,
      },
      {
        on_stream_event: (event) => {
          observed_events.push(event.type);
        },
      },
    );

    const messages = await list_run_messages(db, bootstrap.workspace_id, completed_run.run_id);
    const user_message = messages.find((message) => message.message_role === 'user');
    const assistant_message = messages.find((message) => message.message_role === 'assistant');

    expect(completed_run.run_status).toBe('completed');
    expect(observed_events).toEqual([
      'run_created',
      'run_updated',
      'message_created',
      'message_created',
      'run_updated',
    ]);
    expect(user_message).toMatchObject({
      content_text: 'internal scout prompt',
      is_user_visible: false,
      is_model_visible: true,
    });
    expect(assistant_message).toMatchObject({
      content_text: '{"actions":[{"type":"no_change","reason":"HEARTBEAT_OK"}]}',
      is_user_visible: false,
      is_model_visible: true,
    });
  });
});
