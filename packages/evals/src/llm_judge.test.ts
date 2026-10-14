import { create_fake_llm_adapter, create_llm_gateway } from '@agent-core/llm_gateway';
import type { EvalTask } from '@coworker/evals/eval_types';
import { run_llm_judge } from '@coworker/evals/llm_judge';
import type { ObservedRunTrace } from '@coworker/evals/observed_run_trace';
import { describe, expect, it } from 'vitest';

describe('run_llm_judge', () => {
  it('parses a rubric-shaped result and records the independent judge model', async () => {
    const gateway = create_llm_gateway({
      adapter: create_fake_llm_adapter(JSON.stringify(judge_response(84))),
      environment: { OPENAI_API_KEY: 'test-key' },
    });

    const result = await run_llm_judge(task_fixture(), trace_fixture(), [], { gateway });

    expect(result.judgment).toMatchObject({ passed: true, score: 84 });
    expect(result.model_id).toContain('openai/');
  });

  it('does not let the model pass a score below the task threshold', async () => {
    const response = judge_response(69);
    response.score = 99;
    const gateway = create_llm_gateway({
      adapter: create_fake_llm_adapter(JSON.stringify(response)),
      environment: { OPENAI_API_KEY: 'test-key' },
    });

    const result = await run_llm_judge(task_fixture(), trace_fixture(), [], { gateway });

    expect(result.judgment).toMatchObject({ passed: false, score: 69 });
  });

  it('normalizes provider JSON that keys criteria by rubric name', async () => {
    const response = {
      ...judge_response(76),
      criteria: {
        task_completion: {
          score: 76,
          reason: 'The requested output is present.',
        },
      },
    };
    const gateway = create_llm_gateway({
      adapter: create_fake_llm_adapter(JSON.stringify(response)),
      environment: { OPENAI_API_KEY: 'test-key' },
    });

    const result = await run_llm_judge(task_fixture(), trace_fixture(), [], { gateway });

    expect(result.judgment.criteria).toEqual([
      {
        criterion_name: 'task_completion',
        score: 76,
        reason: 'The requested output is present.',
        evidence: [],
      },
    ]);
  });

  it('rejects a judge that resolves to the candidate model before grading', async () => {
    const gateway = create_llm_gateway({
      adapter: create_fake_llm_adapter(() => {
        throw new Error('the self-judge request must not reach the provider');
      }),
      environment: { ANTHROPIC_API_KEY: 'test-key' },
    });

    await expect(run_llm_judge(task_fixture(), trace_fixture(), [], { gateway })).rejects.toThrow(
      'Judge model must differ from candidate model: claude-sonnet-5',
    );
  });

  it('redacts credential-shaped trace data before calling the judge provider', async () => {
    const trace = trace_fixture();
    trace.messages.push({
      message_role: 'tool',
      message_kind: 'tool_result',
      content_text: 'password: fixture-password-123! and sk-abcdefghijklmnopqrstuvwxyz123456',
      is_user_visible: false,
      source_type: 'runtime',
      source_metadata: {},
      created_time: new Date(),
    });
    trace.tool_calls.push({
      tool_name: 'fixture',
      tool_status: 'completed',
      risk_class: null,
      approval_mode: null,
      input_data: { api_key: 'plain-test-key', nested: { authorization: 'Bearer plain-token' } },
      output_text: 'cookie=session-cookie-value',
      output_data: null,
      error_code: null,
      error_message: null,
      duration_ms: 1,
      created_time: new Date(),
    });
    let serialized_request = '';
    const gateway = create_llm_gateway({
      adapter: create_fake_llm_adapter((input) => {
        serialized_request = JSON.stringify(input.messages);
        return JSON.stringify(judge_response(84));
      }),
      environment: { OPENAI_API_KEY: 'test-key' },
    });

    await run_llm_judge(task_fixture(), trace, [], { gateway });

    expect(serialized_request).toContain('[redacted-secret]');
    expect(serialized_request).not.toContain('fixture-password-123!');
    expect(serialized_request).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(serialized_request).not.toContain('plain-test-key');
    expect(serialized_request).not.toContain('plain-token');
    expect(serialized_request).not.toContain('session-cookie-value');
  });
});

function task_fixture(): EvalTask {
  return {
    task_id: 'operator_001',
    prompt: 'Create a sourced launch brief.',
    workspace_provider: 'local',
    runner: { runner_type: 'slack_observed' },
    graders: [],
    judge: {
      minimum_score: 70,
      criteria: [
        { criterion_name: 'task_completion', description: 'Complete the task.', weight: 100 },
      ],
    },
  };
}

function judge_response(score: number) {
  return {
    passed: true,
    score,
    summary: 'The trace supports the result.',
    criteria: [
      {
        criterion_name: 'task_completion',
        score,
        reason: 'The requested output is present.',
        evidence: ['tool_1'],
      },
    ],
    critical_failures: [],
    missing_evidence: [],
    missed_tool_calls: [],
  };
}

function trace_fixture(): ObservedRunTrace {
  return {
    run: {
      run_id: 'run_test',
      workspace_id: 'ws_test',
      session_id: 'ses_test',
      run_status: 'completed',
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-5',
      error_code: null,
      error_message: null,
      duration_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 0,
      cost_microcents: 5,
      run_metadata: {},
      created_time: new Date(),
    },
    messages: [],
    tool_calls: [],
    files: [],
  };
}
