import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserEvalTask } from '@coworker/evals/browser/browser_eval_types';
import { parse } from 'yaml';
import { z } from 'zod';

const non_empty_string = z.string().min(1);
const browser_grader_schema = z.discriminatedUnion('grader_type', [
  z.object({ grader_type: z.literal('url_matches'), pattern: non_empty_string }),
  z.object({ grader_type: z.literal('snapshot_contains'), text: non_empty_string }),
  z.object({ grader_type: z.literal('page_contains'), text: non_empty_string }),
  z.object({ grader_type: z.literal('final_text_contains'), text: non_empty_string }),
  z.object({ grader_type: z.literal('final_text_excludes'), text: non_empty_string }),
]);
const browser_eval_task_schema = z.object({
  task_id: non_empty_string,
  suite: z.enum(['smoke', 'realistic', 'act_then_verify']),
  goal: non_empty_string,
  start_url: non_empty_string.optional(),
  max_steps: z.number().int().positive().optional(),
  graders: z.array(browser_grader_schema),
});

export async function load_browser_eval_tasks(suite_name?: string): Promise<BrowserEvalTask[]> {
  const tasks_directory = resolve(import.meta.dirname, '../../tasks/browser');
  const task_files = (await readdir(tasks_directory))
    .filter((file_name) => file_name.endsWith('.yaml') || file_name.endsWith('.yml'))
    .sort();

  const tasks = await Promise.all(
    task_files.map(async (file_name) =>
      parse_browser_eval_task(parse(await readFile(resolve(tasks_directory, file_name), 'utf8'))),
    ),
  );
  if (!suite_name) return tasks;
  return tasks.filter((task) => task.suite === suite_name);
}

export function parse_browser_eval_task(value: unknown): BrowserEvalTask {
  return browser_eval_task_schema.parse(value);
}
