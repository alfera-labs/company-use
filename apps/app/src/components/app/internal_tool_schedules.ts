import { z } from 'zod';
import { schedule_tool_words as words } from '@/components/app/automations/schedule_tool_words';
import {
  type InternalToolDefinition,
  type InternalToolView,
  safe_http_url,
} from '@/components/app/internal_tool_view';
import { describe_schedule } from '@/lib/scheduled_task_schedule';

const task_schema = z.object({
  scheduled_task_id: z.string(),
  name: z.string(),
  status: z.string(),
  cron_expression: z.string().nullable(),
  instruction: z.string().nullable(),
  context_digest: z.string().nullable(),
  timezone: z.string().nullable(),
  run_once_at: z.string().nullable(),
  next_run_time: z.string().nullable(),
  last_run_time: z.string().nullable(),
});

const task_output = z.object({
  scheduled_task: task_schema,
  dashboard_url: z.string(),
  activation: z
    .object({ status: z.literal('waiting_for_card'), say_to_user: z.string() })
    .optional(),
});

const list_output = z.object({ count: z.number(), scheduled_tasks: z.array(task_schema) });
const delete_output = z.object({ scheduled_task_id: z.string(), deleted: z.boolean() });

export const schedule_tool_definitions = {
  'scheduled_tasks-create_scheduled_task': schedule_definition(words.create_title, task_view),
  'scheduled_tasks-list_scheduled_tasks': schedule_definition(words.list_title, list_view),
  'scheduled_tasks-edit_scheduled_task': schedule_definition(words.edit_title, task_view),
  'scheduled_tasks-set_scheduled_task_status': schedule_definition(words.status_title, task_view),
  'scheduled_tasks-delete_scheduled_task': schedule_definition(words.delete_title, delete_view),
} satisfies Record<string, InternalToolDefinition>;

function schedule_definition(
  title: string,
  read_view: (output: unknown) => InternalToolView | null,
): InternalToolDefinition {
  return { family: 'schedules', title, read_view: (_input, output) => read_view(output) };
}

function task_view(output: unknown): InternalToolView | null {
  const parsed = task_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  const task = data.scheduled_task;
  const dashboard_url = read_dashboard_url(data.dashboard_url);
  return {
    summary: `${task.name} · ${task.status}`,
    ...(data.activation ? { notice: data.activation.say_to_user } : {}),
    items: dashboard_url ? [{ title: words.view_link, url: dashboard_url }] : [],
    fields: task_fields(task),
    ...(task.instruction ? { text: task.instruction } : {}),
  };
}

function list_view(output: unknown): InternalToolView | null {
  const parsed = list_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: `${data.count} scheduled ${data.count === 1 ? 'task' : 'tasks'}`,
    items: data.scheduled_tasks.map((task) => ({
      title: task.name,
      detail: `${task.status} · ${task_schedule(task)}`,
    })),
    ...(data.scheduled_tasks.length === 0 ? { empty_message: words.none_found } : {}),
  };
}

function delete_view(output: unknown): InternalToolView | null {
  const parsed = delete_output.safeParse(output);
  if (!parsed.success) return null;
  return {
    summary: parsed.data.deleted ? words.was_deleted : 'Deletion did not complete.',
    ...(!parsed.data.deleted ? { notice: words.was_not_deleted } : {}),
    fields: [{ label: 'Deleted', value: parsed.data.deleted ? 'Yes' : 'No' }],
  };
}

function task_fields(task: z.infer<typeof task_schema>) {
  return [
    { label: 'Status', value: task.status },
    { label: 'Schedule', value: task_schedule(task) },
    ...(task.timezone ? [{ label: 'Timezone', value: task.timezone }] : []),
    ...(task.next_run_time ? [{ label: 'Next run', value: task.next_run_time }] : []),
    ...(task.last_run_time ? [{ label: 'Last run', value: task.last_run_time }] : []),
    ...(task.context_digest ? [{ label: 'Context', value: task.context_digest }] : []),
  ];
}

function task_schedule(task: z.infer<typeof task_schema>) {
  if (task.run_once_at) return `Once at ${task.run_once_at}`;
  return describe_schedule(task.cron_expression);
}

function read_dashboard_url(value: string) {
  const public_url = safe_http_url(value);
  if (public_url) return public_url;
  return /^\/scheduled-tasks(?:\/|$)/u.test(value) ? value : null;
}
