import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session, get_run } from '@coworker/core/db/queries/sessions';
import { summarize_workspace_usage } from '@coworker/core/db/queries/usage';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.OPENAI_API_KEY ||= 'test_openai_key';
});

const provider_usage = {
  input: 12,
  output: 8,
  cacheRead: 2,
  cacheWrite: 0,
  totalTokens: 20,
  cost: {
    input: 0.001,
    output: 0.002,
    cacheRead: 0.0001,
    cacheWrite: 0,
    total: 0.0031,
  },
};

function answer_once_with_provider_usage(): RuntimeAgentEngine {
  return {
    engine_name: 'agent-core/pi/stream-observer-billable-usage-test',
    async *run() {
      yield {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          metadata: { usage: provider_usage },
        },
      };
    },
  };
}

describe('runtime stream observers', () => {
  afterEach(() => {
    configure_agent_engine(create_pi_engine);
  });

  it('records usage at the provider cost from provider cost metadata', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    configure_agent_engine(answer_once_with_provider_usage);

    const completed_run = await start_agent_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      user_message: 'finish this',
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
      workspace_runtime_provider: 'local',
    });

    const persisted_run = await get_run(db, bootstrap.workspace_id, completed_run.run_id);
    const usage = await summarize_workspace_usage(db, {
      workspace_id: bootstrap.workspace_id,
    });

    expect(persisted_run?.input_tokens).toBe(12);
    expect(persisted_run?.output_tokens).toBe(8);
    expect(persisted_run?.cache_read_tokens).toBe(2);
    expect(persisted_run?.cost_microcents).toBe(310_000);
    expect(persisted_run?.usage_metadata).toMatchObject({
      billing: {
        pricing_version: 'at_cost',
        provider_cost_microcents: 310_000,
        billable_cost_microcents: 310_000,
      },
      provider_usage: {
        totalTokens: 20,
        cost: { total: 0.0031 },
      },
    });
    expect(usage.total_cost_microcents).toBe(310_000);
  });
});
