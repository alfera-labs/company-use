import { load_eval_tasks, parse_eval_task_file } from '@coworker/evals/task_source';
import { describe, expect, it } from 'vitest';

describe('load_eval_tasks', () => {
  it('keeps existing smoke tasks on the legacy runner', async () => {
    const tasks = await load_eval_tasks('smoke');
    const task = tasks.find(
      (candidate) => candidate.task_id === 'tool_004_pi_coding_tools_recorded',
    );

    expect(task?.runner).toEqual({ runner_type: 'legacy_task' });
  });

  it('loads fullstack scripted actions and HTTP graders', async () => {
    const tasks = await load_eval_tasks('fullstack_smoke');
    const task = tasks.find(
      (candidate) => candidate.task_id === 'fullstack_001_nextjs_api_landing',
    );

    expect(task?.workspace_provider).toBe('docker');
    expect(task?.runner.runner_type).toBe('scripted_actions');
    expect(task?.graders.some((grader) => grader.grader_type === 'http_server_checks')).toBe(true);
  });

  it('loads the complete Slack operator prompt bank from shared defaults', async () => {
    const tasks = await load_eval_tasks('slack_operator');

    expect(tasks).toHaveLength(48);
    expect(tasks[0]).toMatchObject({
      task_id: 'connection_001',
      runner: { runner_type: 'slack_observed' },
      judge: { minimum_score: 70 },
    });
    expect(tasks.every((task) => task.graders.length === 4)).toBe(true);
    expect(tasks.at(-1)?.task_id).toBe('autonomy_004');
  });

  it('rejects invalid judge weights and duplicate criteria', () => {
    expect(() => parse_eval_task_file(task_file_with_criteria([-10, 110]))).toThrow(
      'weight must be positive',
    );
    expect(() => parse_eval_task_file(task_file_with_criteria([50, 50], ['same', 'same']))).toThrow(
      'judge criteria names must be unique',
    );
  });
});

function task_file_with_criteria(weights: number[], names = ['first', 'second']) {
  return {
    task_id: 'judge_fixture',
    prompt: 'Grade this fixture.',
    workspace_provider: 'local',
    runner: { runner_type: 'slack_observed' },
    graders: [],
    judge: {
      minimum_score: 70,
      criteria: weights.map((weight, index) => ({
        criterion_name: names[index],
        description: 'Fixture criterion.',
        weight,
      })),
    },
  };
}
