import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it, vi } from 'vitest';

const engine_calls = vi.hoisted(() => ({
  inputs: [] as { system_prompt: string; conversation_text: string; tool_names: string[] }[],
}));

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/answer-prompt-test',
    async *run(input) {
      engine_calls.inputs.push({
        system_prompt: input.system_prompt,
        conversation_text: JSON.stringify(input.messages),
        tool_names: input.tools.map((tool) => tool.tool_name),
      });
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The marquee.' }] },
      } as never;
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

async function run_public_answer(allowed_tool_names: readonly string[]) {
  engine_calls.inputs.length = 0;
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_source: 'api',
    actor_id: bootstrap.user_id,
  });

  await start_agent_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    user_message: 'List every connection and integration you have access to.',
    source_type: 'api',
    allowed_tool_names,
    include_connection_context: false,
    include_imported_persona: false,
    api_key_id: 'key_test',
    actor_id: bootstrap.user_id,
    workspace_runtime_provider: 'local',
  });

  const call = engine_calls.inputs[0];
  if (!call) throw new Error('the answer run never reached the engine');
  return call;
}

describe('the prompt of a public answer run', () => {
  it('offers an external answer run no tools and no protocol for tools it lacks', async () => {
    const { system_prompt, tool_names } = await run_public_answer([]);

    expect(tool_names).toEqual([]);

    expect(system_prompt).not.toContain('## Connected Apps Protocol');
    expect(system_prompt).not.toContain('Inspect Current Connections');
    expect(system_prompt).not.toContain('runtime-list_connections-1');
    expect(system_prompt).not.toContain('## API Proxy Protocol');
    expect(system_prompt).not.toContain('_api_proxy');
    expect(system_prompt).not.toContain('## Catalog Tool Protocol');
    expect(system_prompt).not.toContain('runtime-execute_tool-1');
    expect(system_prompt).not.toContain('## Connection Protocol');
    expect(system_prompt).not.toContain('## Tool Failure Protocol');
    expect(system_prompt).not.toContain('## Slack Format Protocol');
    expect(system_prompt).not.toContain('## Browser Protocol');
    expect(system_prompt).not.toContain('## Available Skills');
    expect(system_prompt).not.toContain('runtime-load_skill-1');
  }, 60_000);

  it('tells an external answer run where it actually is and how its reply is delivered', async () => {
    const { system_prompt, conversation_text } = await run_public_answer([]);

    expect(conversation_text).toContain('a question asked through the public API');
    expect(conversation_text).toContain(
      'Nothing you write reaches Slack, email, or any other channel',
    );
    expect(conversation_text).toContain('Do not promise to send, post, share, or follow up later');
    expect(conversation_text).not.toContain('web chat (dashboard)');
    expect(conversation_text).not.toContain('You have every tool available');
    expect(system_prompt).not.toContain('web chat (dashboard)');
    expect(system_prompt).not.toContain('You have every tool available');
    expect(system_prompt).not.toContain('## Memory');
    expect(system_prompt).toContain('## Live Source Protocol');
    expect(system_prompt).not.toContain('<workspace_memory>');
    expect(conversation_text).not.toContain('<workspace_memory>');
  }, 60_000);
});
