import { calculate_task_rubric_fingerprint } from '@coworker/evals/eval_definition_fingerprint';
import type { EvalTask } from '@coworker/evals/eval_types';
import { describe, expect, it } from 'vitest';

describe('task rubric fingerprint', () => {
  it('is stable across object key order', () => {
    const task = task_fixture();
    const reordered = {
      judge: task.judge,
      graders: task.graders,
      runner: task.runner,
      workspace_provider: task.workspace_provider,
      prompt: task.prompt,
      task_id: task.task_id,
    } as EvalTask;

    expect(calculate_task_rubric_fingerprint(reordered)).toBe(
      calculate_task_rubric_fingerprint(task),
    );
  });

  it('changes when the prompt or rubric changes', () => {
    const task = task_fixture();
    const changed_prompt = { ...task, prompt: 'A different requirement.' };
    const changed_rubric = {
      ...task,
      judge: {
        minimum_score: 80,
        criteria: [{ criterion_name: 'completion', description: 'Changed.', weight: 100 }],
      },
    };

    expect(calculate_task_rubric_fingerprint(changed_prompt)).not.toBe(
      calculate_task_rubric_fingerprint(task),
    );
    expect(calculate_task_rubric_fingerprint(changed_rubric)).not.toBe(
      calculate_task_rubric_fingerprint(task),
    );
  });
});

function task_fixture(): EvalTask {
  return {
    task_id: 'task_001',
    prompt: 'Complete the requested operation.',
    workspace_provider: 'local',
    runner: { runner_type: 'slack_observed' },
    graders: [{ grader_type: 'minimum_tool_calls', count: 1 }],
    judge: {
      minimum_score: 70,
      criteria: [{ criterion_name: 'completion', description: 'Complete the task.', weight: 100 }],
    },
  };
}
