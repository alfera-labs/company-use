import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvalTask } from '@coworker/evals/eval_types';
import { parse } from 'yaml';
import { z } from 'zod';

const non_empty_string = z.string().min(1);
const finite_number = z.number().finite();
const command_schema = z.object({
  command: non_empty_string,
  args: z.array(non_empty_string).optional(),
  cwd: non_empty_string.optional(),
  timeout_ms: finite_number.optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const http_check_schema = z.object({
  url: non_empty_string,
  status: finite_number.optional(),
  contains: non_empty_string.optional(),
});
const action_schema = z.discriminatedUnion('action_type', [
  z.object({
    action_type: z.literal('write_file'),
    path: non_empty_string,
    content: non_empty_string,
  }),
  z.object({ action_type: z.literal('run_command'), command: command_schema }),
  z.object({
    action_type: z.literal('create_message'),
    role: z.enum(['user', 'assistant', 'tool_result']),
    text: non_empty_string,
  }),
  z.object({ action_type: z.literal('create_context_snapshot') }),
  z.object({
    action_type: z.literal('workspace_tool'),
    tool_name: non_empty_string,
    input: z.unknown().optional(),
  }),
]);
const runner_schema = z.discriminatedUnion('runner_type', [
  z.object({ runner_type: z.literal('legacy_task') }),
  z.object({ runner_type: z.literal('slack_observed') }),
  z.object({ runner_type: z.literal('scripted_actions'), actions: z.array(action_schema) }),
  z.object({
    runner_type: z.literal('coworker_agent'),
    timeout_ms: finite_number.optional(),
    reasoning_level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    temperature: finite_number.optional(),
    max_output_tokens: finite_number.optional(),
  }),
]);
const grader_schema = z.discriminatedUnion('grader_type', [
  z.object({ grader_type: z.literal('exact_json'), path: non_empty_string, value: z.unknown() }),
  z.object({ grader_type: z.literal('db_assertion'), assertion: non_empty_string }),
  z.object({ grader_type: z.literal('file_exists'), path: non_empty_string }),
  z.object({
    grader_type: z.literal('file_contains'),
    path: non_empty_string,
    text: non_empty_string,
  }),
  z.object({ grader_type: z.literal('tool_call_recorded'), tool_name: non_empty_string }),
  z.object({ grader_type: z.literal('artifact_recorded'), workspace_path: non_empty_string }),
  z.object({ grader_type: z.literal('run_ended_clean') }),
  z.object({ grader_type: z.literal('assistant_response_present') }),
  z.object({ grader_type: z.literal('slack_turn_delivered') }),
  z.object({ grader_type: z.literal('no_prohibited_side_effects') }),
  z.object({ grader_type: z.literal('path_escape_rejected') }),
  z.object({ grader_type: z.literal('symlink_escape_rejected') }),
  z.object({ grader_type: z.literal('command_env_secret_absent') }),
  z.object({ grader_type: z.literal('minimum_tool_calls'), count: z.number().int().nonnegative() }),
  z.object({
    grader_type: z.literal('command_succeeds'),
    command: command_schema,
    expected_exit_code: finite_number.optional(),
  }),
  z.object({
    grader_type: z.literal('command_output_contains'),
    command: command_schema,
    text: non_empty_string,
  }),
  z.object({
    grader_type: z.literal('http_server_checks'),
    server: command_schema,
    checks: z.array(http_check_schema),
    ready_timeout_ms: finite_number.optional(),
    request_timeout_ms: finite_number.optional(),
    port: finite_number.optional(),
  }),
]);
const judge_schema = z
  .object({
    minimum_score: z.number().min(0).max(100),
    criteria: z.array(
      z.object({
        criterion_name: non_empty_string,
        description: non_empty_string,
        weight: z.number().positive({ message: 'weight must be positive' }),
      }),
    ),
  })
  .superRefine((judge, context) => {
    const criterion_names = judge.criteria.map((criterion) => criterion.criterion_name);
    if (new Set(criterion_names).size !== criterion_names.length) {
      context.addIssue({ code: 'custom', message: 'judge criteria names must be unique' });
    }
    const total_weight = judge.criteria.reduce((total, criterion) => total + criterion.weight, 0);
    if (total_weight !== 100) {
      context.addIssue({ code: 'custom', message: 'judge criteria weights must total 100' });
    }
  });
const task_schema = z
  .object({
    task_id: non_empty_string,
    prompt: non_empty_string,
    workspace_provider: z.enum(['local', 'docker', 'e2b']),
    runner: runner_schema.optional(),
    graders: z.array(grader_schema),
    judge: judge_schema.optional(),
  })
  .transform((task) => ({
    ...task,
    runner: task.runner ?? { runner_type: 'legacy_task' as const },
  }));
const task_group_schema = z.object({
  defaults: z.record(z.string(), z.unknown()),
  tasks: z.array(z.record(z.string(), z.unknown())),
});

export async function load_eval_tasks(suite_name: string): Promise<EvalTask[]> {
  const tasks_directory = resolve(import.meta.dirname, '../tasks', suite_name);
  const task_files = (await readdir(tasks_directory))
    .filter((file_name) => file_name.endsWith('.yaml') || file_name.endsWith('.yml'))
    .sort();

  const task_groups = await Promise.all(
    task_files.map(async (file_name) =>
      parse_eval_task_file(parse(await readFile(resolve(tasks_directory, file_name), 'utf8'))),
    ),
  );
  return task_groups.flat();
}

export function parse_eval_task_file(value: unknown): EvalTask[] {
  const task_group = task_group_schema.safeParse(value);
  if (!task_group.success) return [task_schema.parse(value)];
  return task_group.data.tasks.map((task) =>
    task_schema.parse({ ...task_group.data.defaults, ...task }),
  );
}
