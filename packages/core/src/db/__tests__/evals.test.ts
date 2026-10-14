import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_eval_report, list_eval_reports } from '@coworker/core/db/queries/evals';
import {
  create_run,
  create_run_message,
  create_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import {
  find_latest_slack_eval_prompt_run,
  list_slack_eval_run_candidates,
} from '@coworker/core/db/queries/slack_evals';
import { describe, expect, it } from 'vitest';

async function create_eval_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'evals fixture',
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

function eval_report_input(overrides: Partial<Parameters<typeof create_eval_report>[1]>) {
  return {
    suite_name: 'smoke',
    task_source: 'internal' as const,
    task_id: 'ctx_001_first_message_preserved',
    run_id: 'placeholder',
    harness_name: 'coworker',
    harness_version: '0.1.0',
    runtime_version: 'sha-abc123',
    model_id: 'claude-haiku-4-5-20251001',
    status: 'pass' as const,
    duration_ms: 1234,
    trace_pointer: '/runs/run_test/inspect',
    actor_id: 'system',
    ...overrides,
  };
}

describe('eval_reports queries', () => {
  it('creates an eval report with default token + cost fields zeroed', async () => {
    const { db, run, bootstrap } = await create_eval_fixture();
    const report = await create_eval_report(
      db,
      eval_report_input({ run_id: run.run_id, actor_id: bootstrap.user_id }),
    );
    expect(report).toMatchObject({
      suite_name: 'smoke',
      task_source: 'internal',
      task_id: 'ctx_001_first_message_preserved',
      run_id: run.run_id,
      harness_name: 'coworker',
      status: 'pass',
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      tool_call_count: 0,
      metadata: {},
    });
    expect(Number(report.cost_microcents)).toBe(0);
  });

  it('stores auditable judge metadata on the eval report', async () => {
    const { db, run, bootstrap } = await create_eval_fixture();
    const report = await create_eval_report(
      db,
      eval_report_input({
        run_id: run.run_id,
        actor_id: bootstrap.user_id,
        metadata: { judge: { score: 84, passed: true } },
      }),
    );

    expect(report.metadata).toEqual({ judge: { score: 84, passed: true } });
  });

  it('enforces uniqueness on (suite_name, task_id, run_id) per the done definition', async () => {
    const { db, run, bootstrap } = await create_eval_fixture();
    const input = eval_report_input({ run_id: run.run_id, actor_id: bootstrap.user_id });
    await create_eval_report(db, input);
    await expect(create_eval_report(db, input)).rejects.toThrow();
  });

  it('lists eval reports filtered by suite_name', async () => {
    const { db, run, bootstrap } = await create_eval_fixture();
    await create_eval_report(
      db,
      eval_report_input({
        run_id: run.run_id,
        task_id: 'a_task',
        suite_name: 'smoke',
        actor_id: bootstrap.user_id,
      }),
    );
    await create_eval_report(
      db,
      eval_report_input({
        run_id: run.run_id,
        task_id: 'b_task',
        suite_name: 'extended',
        actor_id: bootstrap.user_id,
      }),
    );
    const smoke = await list_eval_reports(db, { suite_name: 'smoke' });
    expect(smoke.map((row) => row.task_id)).toEqual(['a_task']);
    const extended = await list_eval_reports(db, { suite_name: 'extended' });
    expect(extended.map((row) => row.task_id)).toEqual(['b_task']);
  });

  it('lists eval reports filtered by suite_name + runtime_version', async () => {
    const { db, run, bootstrap } = await create_eval_fixture();
    await create_eval_report(
      db,
      eval_report_input({
        run_id: run.run_id,
        task_id: 'task_a',
        runtime_version: 'sha-old',
        actor_id: bootstrap.user_id,
      }),
    );
    await create_eval_report(
      db,
      eval_report_input({
        run_id: run.run_id,
        task_id: 'task_b',
        runtime_version: 'sha-new',
        actor_id: bootstrap.user_id,
      }),
    );
    const new_only = await list_eval_reports(db, {
      suite_name: 'smoke',
      runtime_version: 'sha-new',
    });
    expect(new_only.map((row) => row.task_id)).toEqual(['task_b']);
  });

  it('finds exact Slack prompts from the requested actor without scanning other workspaces', async () => {
    const { db, session, bootstrap } = await create_eval_fixture();
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'build the launch brief' },
      source_type: 'slack',
      source_metadata: {
        source_actor: { profile: { email: 'fixtures@example.com' } },
        slack: { channel_id: 'C123' },
      },
      actor_id: bootstrap.user_id,
    });

    const running_candidates = await list_slack_eval_run_candidates(db, {
      prompts: ['build the launch brief'],
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
    });
    const running_prompt = await find_latest_slack_eval_prompt_run(db, {
      prompt: 'build the launch brief',
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
    });
    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
    });

    const candidates = await list_slack_eval_run_candidates(db, {
      prompts: ['build the launch brief'],
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
    });
    const wrong_actor = await list_slack_eval_run_candidates(db, {
      prompts: ['build the launch brief'],
      workspace_id: bootstrap.workspace_id,
      actor_email: 'someone@example.com',
      since: new Date(0),
    });
    const wrong_channel = await list_slack_eval_run_candidates(db, {
      prompts: ['build the launch brief'],
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      channel_id: 'C999',
      since: new Date(0),
    });

    expect(running_candidates).toEqual([]);
    expect(running_prompt).toMatchObject({ run_id: run.run_id, run_status: 'queued' });
    expect(candidates).toMatchObject([
      { run_id: run.run_id, prompt_text: 'build the launch brief' },
    ]);
    expect(wrong_actor).toEqual([]);
    expect(wrong_channel).toEqual([]);
  });
});
