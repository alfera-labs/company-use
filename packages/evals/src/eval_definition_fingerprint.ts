import { createHash } from 'node:crypto';
import type { EvalTask } from '@coworker/evals/eval_types';

const fingerprint_schema_version = 1;

export function calculate_task_rubric_fingerprint(task: EvalTask) {
  const grading_definition = {
    fingerprint_schema_version,
    task_id: task.task_id,
    prompt: task.prompt,
    graders: task.graders,
    judge: task.judge ?? null,
  };
  return createHash('sha256').update(stable_json(grading_definition)).digest('hex');
}

function stable_json(value: unknown) {
  return JSON.stringify(sort_object_fields(value));
}

function sort_object_fields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_object_fields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field_value]) => field_value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field_value]) => [key, sort_object_fields(field_value)]),
  );
}
