import { create_fake_llm_adapter, create_llm_gateway } from '@agent-core/llm_gateway';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_eval_reports } from '@coworker/core/db/queries/evals';
import {
  add_usage_to_run_totals,
  create_run,
  create_run_message,
  create_session,
  create_tool_call_started,
  update_run_status,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import { eval_reports, runs as runs_table } from '@coworker/core/db/schema';
import type { EvalTask } from '@coworker/evals/eval_types';
import { grade_slack_observed_suite } from '@coworker/evals/slack_observed_runner';
import { load_eval_tasks } from '@coworker/evals/task_source';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const source_event_time = new Date('2026-07-14T10:00:00.000Z');
const internal_run_duration_ms = 120_000;
const end_to_end_duration_ms = 600_000;

describe('grade_slack_observed_suite', () => {
  it('discovers, grades, judges, persists, and idempotently reads a real Slack run trace', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const task = await load_task('connection_001');
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Robin operator eval',
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-5',
      actor_id: bootstrap.user_id,
    });
    await create_slack_prompt(db, bootstrap, session.session_id, run.run_id, task.prompt);
    await create_slack_reply(db, bootstrap, session.session_id, run.run_id);
    await add_usage_to_run_totals(db, {
      run_id: run.run_id,
      input_tokens: 100,
      output_tokens: 50,
      cost_microcents: 7,
      actor_id: bootstrap.user_id,
    });
    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
    });
    await db
      .update(runs_table)
      .set({
        completed_time: new Date(source_event_time.getTime() + end_to_end_duration_ms),
        duration_ms: internal_run_duration_ms,
        total_run_ms: internal_run_duration_ms,
      })
      .where(eq(runs_table.run_id, run.run_id));

    const unjudged = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      skip_judge: true,
    });
    const failed_judge = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: invalid_judge_gateway(),
    });
    const deterministic_after_judge_error = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      skip_judge: true,
    });
    const result = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: passing_judge_gateway(task),
    });
    const repeated = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: passing_judge_gateway(task, 70),
    });
    await change_report_metadata(db, result.task_results[0]?.eval_report_id, (metadata) => ({
      ...metadata,
      task_rubric_fingerprint: 'stale-fingerprint',
    }));
    const refreshed_fingerprint = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: passing_judge_gateway(task, 84),
    });
    await change_report_metadata(
      db,
      refreshed_fingerprint.task_results[0]?.eval_report_id,
      downgrade_execution_score_schema,
    );
    const refreshed_score_schema = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: passing_judge_gateway(task, 76),
    });
    const rejudged = await grade_slack_observed_suite(db, 'slack_operator', {
      workspace_id: bootstrap.workspace_id,
      actor_email: 'fixtures@example.com',
      since: new Date(0),
      task_id: task.task_id,
      judge_gateway: passing_judge_gateway(task, 88),
      rejudge: true,
    });
    const reports = await list_eval_reports(db, { suite_name: 'slack_operator' });

    expect(unjudged.task_results[0]).toMatchObject({ status: 'pass' });
    expect(unjudged.task_results[0]).not.toHaveProperty('judge_score');
    expect(failed_judge.task_results[0]).toMatchObject({
      status: 'error',
      failure_reason: 'upstream_error',
    });
    expect(deterministic_after_judge_error.task_results[0]).toMatchObject({
      status: 'pass',
      failure_reason: null,
    });
    expect(result).toMatchObject({
      pass_rate: 1,
      p50_duration_ms: end_to_end_duration_ms,
      task_results: [
        {
          status: 'pass',
          judge_score: 92,
          duration_ms: end_to_end_duration_ms,
          end_to_end_duration_ms,
          internal_run_duration_ms,
          speed_score: 30,
        },
      ],
    });
    expect(repeated.task_results[0]?.eval_report_id).toBe(result.task_results[0]?.eval_report_id);
    expect(repeated.task_results[0]?.judge_score).toBe(92);
    expect(refreshed_fingerprint.task_results[0]?.judge_score).toBe(84);
    expect(refreshed_score_schema.task_results[0]?.judge_score).toBe(76);
    expect(rejudged.task_results[0]).toMatchObject({ status: 'pass', judge_score: 88 });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      task_source: 'slack',
      task_id: task.task_id,
      run_id: run.run_id,
      status: 'pass',
      metadata: {
        source: 'slack_observed',
        actor_email: 'fixtures@example.com',
        task_rubric_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        execution_scores: {
          schema_version: 2,
          end_to_end_duration_ms,
          internal_run_duration_ms,
        },
        judge: { passed: true, score: 88 },
      },
    });
  });
});

async function change_report_metadata(
  db: Parameters<typeof list_eval_reports>[0],
  eval_report_id: string | undefined,
  change: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  if (!eval_report_id) throw new Error('Missing eval report id');
  const [report] = await db
    .select()
    .from(eval_reports)
    .where(eq(eval_reports.eval_report_id, eval_report_id));
  if (!report) throw new Error(`Missing eval report: ${eval_report_id}`);
  await db
    .update(eval_reports)
    .set({ metadata: change(report.metadata) })
    .where(eq(eval_reports.eval_report_id, eval_report_id));
}

function downgrade_execution_score_schema(metadata: Record<string, unknown>) {
  const scores = metadata.execution_scores as { schema_version: number };
  return { ...metadata, execution_scores: { ...scores, schema_version: 0 } };
}

async function load_task(task_id: string) {
  const task = (await load_eval_tasks('slack_operator')).find((item) => item.task_id === task_id);
  if (!task) throw new Error(`Missing eval task fixture: ${task_id}`);
  return task;
}

async function create_slack_prompt(
  db: Parameters<typeof create_run_message>[0],
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  session_id: string,
  run_id: string,
  prompt: string,
) {
  await create_run_message(db, {
    workspace_id: bootstrap.workspace_id,
    session_id,
    run_id,
    message_role: 'user',
    message_content: { type: 'text', text: prompt },
    source_type: 'slack',
    source_metadata: {
      source_actor: { profile: { email: 'fixtures@example.com' } },
      slack: {
        channel_id: 'C_EVALS',
        event_ts: String(source_event_time.getTime() / 1000),
      },
    },
    actor_id: bootstrap.user_id,
  });
}

async function create_slack_reply(
  db: Parameters<typeof create_tool_call_started>[0],
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  session_id: string,
  run_id: string,
) {
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id,
    run_id,
    agent_id: bootstrap.agent_id,
    tool_name: 'slack-respond-1',
    tool_input: {
      message: 'I checked the requested services and clearly reported their connection state.',
      resolution_type: 'reply',
      keep_working: false,
    },
    actor_id: bootstrap.user_id,
  });
  await update_tool_call_finished(db, {
    tool_call_id: tool_call.tool_call_id,
    tool_status: 'completed',
    output: { ok: true },
    duration_ms: 20,
    actor_id: bootstrap.user_id,
  });
}

function passing_judge_gateway(task: EvalTask, score = 92) {
  const response = {
    passed: true,
    score,
    summary: 'The trace supports a complete and accurate response.',
    criteria: task.judge?.criteria.map((criterion) => ({
      criterion_name: criterion.criterion_name,
      score,
      reason: 'The trace contains direct supporting evidence.',
      evidence: ['tool_1'],
    })),
    critical_failures: [],
    missing_evidence: [],
  };
  return create_llm_gateway({
    adapter: create_fake_llm_adapter(JSON.stringify(response)),
    environment: { OPENAI_API_KEY: 'test-key' },
  });
}

function invalid_judge_gateway() {
  return create_llm_gateway({
    adapter: create_fake_llm_adapter('{'),
    environment: { OPENAI_API_KEY: 'test-key' },
  });
}
