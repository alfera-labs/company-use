import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_messages,
  create_session,
  list_session_context_operations,
} from '@coworker/core/db/queries/sessions';
import { calculate_llm_spend } from '@runtime-platform/orchestrator/llm_spend';
import { maybe_compact_session_context } from '@runtime-platform/session_harness/session_compaction';
import {
  session_compaction_tier_token_budget,
  session_compaction_tiers,
} from '@runtime-platform/session_harness/session_compaction_tier';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const summariser = vi.hoisted(() => ({
  usage: undefined as RuntimeRunUsage | undefined,
  calls: [] as { model_name: string; reserve_tokens: number }[],
}));

vi.mock('@agent-core/engines/pi', async (import_original) => {
  const original = await import_original<typeof import('@agent-core/engines/pi')>();
  return {
    ...original,
    run_pi_compaction: async (input: {
      preparation: { settings: { reserveTokens: number } };
      model: { model_name: string };
    }) => {
      summariser.calls.push({
        model_name: input.model.model_name,
        reserve_tokens: input.preparation.settings.reserveTokens,
      });
      return {
        ok: true as const,
        value: {
          summary: '## Goal\nKeep working.',
          firstKeptEntryId: 'm3',
          tokensBefore: 40_000,
          ...(summariser.usage ? { usage: summariser.usage } : {}),
        },
      };
    },
  };
});

const session_model = {
  model_provider: 'anthropic',
  model_proxy: 'anthropic_direct',
  model_name: 'claude-sonnet-5',
  reasoning_level: 'high' as const,
};

function summariser_usage(): RuntimeRunUsage {
  return {
    input: 40_000,
    output: 900,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 40_900,
    cost: { input: 0.04, output: 0.0054, cacheRead: 0, cacheWrite: 0, total: 0.0454 },
  };
}

const forced_compaction_settings = {
  enabled: true,
  reserveTokens: 1_000_000_000,
  keepRecentTokens: 220,
};

beforeEach(() => {
  summariser.usage = summariser_usage();
  summariser.calls = [];
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
});

describe('calculate_llm_spend', () => {
  it('records provider cost while billing nothing when the spend is absorbed', () => {
    const spend = calculate_llm_spend({
      usage: summariser_usage(),
      billing_treatment: 'absorbed',
    });

    expect(spend.provider_cost_microcents).toBe(4_540_000);
    expect(spend.billable_cost_microcents).toBe(0);
    expect(spend.usage_metadata).toMatchObject({
      billing: { billing_treatment: 'absorbed', provider_cost_microcents: 4_540_000 },
    });
  });

  it('records the provider cost when the spend is billed', () => {
    const spend = calculate_llm_spend({ usage: summariser_usage(), billing_treatment: 'billed' });

    expect(spend.provider_cost_microcents).toBe(4_540_000);
    expect(spend.usage_metadata).toMatchObject({
      billing: { billing_treatment: 'billed', provider_cost_microcents: 4_540_000 },
    });
  });
});

describe('session compaction tiers', () => {
  it('gives each tier its own reason so a row can say whether a person waited', () => {
    expect(session_compaction_tiers.soft.operation_reason).not.toBe(
      session_compaction_tiers.hard.operation_reason,
    );
    expect(session_compaction_tiers.hard.blocks_the_turn).toBe(true);
    expect(session_compaction_tiers.soft.blocks_the_turn).toBe(false);
  });

  it('fires soft before hard', () => {
    expect(session_compaction_tier_token_budget('soft', session_model)).toBeLessThan(
      session_compaction_tier_token_budget('hard', session_model),
    );
  });
});

describe('compaction spend on a real session', () => {
  it('records the summariser call as its own usage kind, absorbed, with the model that ran', async () => {
    const workspace = await compactable_session();

    const outcome = await maybe_compact_session_context(workspace.db, {
      ...workspace.compaction_input,
      tier: 'hard',
      settings: forced_compaction_settings,
    });
    expect(outcome.status).toBe('compacted');

    const usage = await workspace.db.query.usage_records.findMany();
    const compaction_usage = usage.filter((record) => record.usage_kind === 'context_compaction');
    expect(compaction_usage).toHaveLength(1);

    const record = compaction_usage[0];
    expect(record?.quantity).toBe('40900');
    expect(record?.provider).toBe('openai');
    expect(Number(record?.cost_microcents)).toBe(0);
    expect(record?.usage_metadata).toMatchObject({
      billing: { billing_treatment: 'absorbed', provider_cost_microcents: 4_540_000 },
      compaction: { tier: 'hard', summary_persisted: true, model_name: 'gpt-5.6-luna' },
    });
  });

  it('stores the summariser model and the tier on the operation', async () => {
    const workspace = await compactable_session();

    await maybe_compact_session_context(workspace.db, {
      ...workspace.compaction_input,
      tier: 'soft',
      settings: forced_compaction_settings,
    });

    const [operation] = await list_session_context_operations(workspace.db, {
      workspace_id: workspace.workspace_id,
      session_id: workspace.session_id,
    });
    expect(operation?.operation_reason).toBe(session_compaction_tiers.soft.operation_reason);
    expect(operation?.operation_data).toMatchObject({
      tier: 'soft',
      model: { model_name: 'claude-sonnet-5' },
      summariser_model: { model_name: 'gpt-5.6-luna', model_provider: 'openai' },
    });
    expect(summariser.calls).toEqual([
      { model_name: 'gpt-5.6-luna', reserve_tokens: forced_compaction_settings.reserveTokens },
    ]);
  });

  it('writes no row when the provider reported no usage', async () => {
    summariser.usage = undefined;
    const workspace = await compactable_session();

    await maybe_compact_session_context(workspace.db, {
      ...workspace.compaction_input,
      tier: 'hard',
      settings: forced_compaction_settings,
    });

    const usage = await workspace.db.query.usage_records.findMany();
    expect(usage.filter((record) => record.usage_kind === 'context_compaction')).toHaveLength(0);
  });
});

async function compactable_session() {
  const db: Database = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });

  await create_run_messages(
    db,
    ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      message_content: { type: 'text' as const, text: `${id} ${'context '.repeat(200)}` },
      source_type: 'dashboard' as const,
      actor_id: bootstrap.user_id,
    })),
  );

  return {
    db,
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    compaction_input: {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      model: session_model,
      actor_id: bootstrap.user_id,
    },
  };
}
