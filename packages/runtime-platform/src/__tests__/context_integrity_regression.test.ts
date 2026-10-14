import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it, vi } from 'vitest';

const engine_calls = vi.hoisted(() => ({
  inputs: [] as { system_prompt: string; tool_names: string[]; messages: unknown[] }[],
}));

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/context-integrity-test',
    async *run(input) {
      engine_calls.inputs.push({
        system_prompt: input.system_prompt,
        tool_names: input.tools.map((tool) => tool.tool_name),
        messages: input.messages,
      });
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the draft.' }] },
      } as never;
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

describe('context integrity on a dashboard turn', () => {
  it('names the authenticated dashboard user in a web-chat turn with no source metadata', async () => {
    engine_calls.inputs.length = 0;
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    await start_agent_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      user_message: 'Who am I?',
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
      workspace_runtime_provider: 'local',
    });

    const engine_input = JSON.stringify(engine_calls.inputs[0] ?? {});
    expect(engine_input).toContain('Founder');
    expect(engine_input).toContain('founder@runtime.local');
  }, 60_000);
});
