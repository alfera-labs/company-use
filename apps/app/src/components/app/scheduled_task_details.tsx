import type { ReactNode } from 'react';
import {
  let_alfera_recommend,
  type ModelChoice,
  selected_model_choice,
} from '@/components/app/model_picker/model_choice';
import { describe_model_choice } from '@/components/app/model_picker/model_display';
import { useModelOptions } from '@/components/app/model_picker/use_model_options';
import { useMainAgent } from '@/components/app/use_main_agent';
import type { Trigger } from '@/lib/api';
import { describe_schedule } from '@/lib/scheduled_task_schedule';

export function ScheduledTaskDetails({ task, edit }: { task: Trigger; edit: ReactNode }) {
  const agents_query = useMainAgent();
  const models_query = useModelOptions();
  const job_input = object_shape_of(object_shape_of(task.trigger_config).job_input);
  const agent =
    agents_query.data?.find((candidate) => candidate.agent_id === task.agent_id) ??
    agents_query.agent;
  const model_choice = read_model_choice(job_input);
  const inherited_choice = agent ? selected_model_choice(agent) : let_alfera_recommend;
  const inherited_model =
    models_query.models.find((model) =>
      inherited_choice.choose_model_by === 'use_this_exact_model'
        ? model.model_proxy === inherited_choice.model_proxy &&
          model.model_id === inherited_choice.model_name
        : model.is_recommended_for_agent_runs,
    ) ?? null;
  const content = Array.isArray(job_input.content) ? job_input.content : [];
  const file_count = content.filter((part) =>
    ['file', 'image'].includes(String(object_shape_of(part).type)),
  ).length;
  const rows = [
    ...list_schedule_rows(task),
    [
      'Model',
      models_query.isLoading || agents_query.isLoading
        ? 'Loading…'
        : describe_model_choice(
            models_query.models,
            model_choice,
            inherited_model,
            inherited_choice,
          ),
    ],
    ['Instructions', string_shape_of(job_input.instruction) || 'No instructions'],
    ...(file_count > 0 ? [['Files', `${file_count} attached`]] : []),
    ...(string_shape_of(job_input.context_digest)
      ? [['Background', string_shape_of(job_input.context_digest)]]
      : []),
  ];

  return (
    <section className="overflow-hidden rounded-3xl border bg-raised shadow-raised">
      <div className="flex h-11 items-center justify-between border-b px-4">
        <h2 className="text-sm font-medium">Details</h2>
        {edit}
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-4 px-4 py-4 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="font-medium text-muted-foreground">{label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function read_model_choice(input: Record<string, unknown>): ModelChoice {
  const model_provider = string_shape_of(input.model_provider);
  const model_proxy = string_shape_of(input.model_proxy);
  const model_name = string_shape_of(input.model_name);
  if (!model_provider || !model_proxy || !model_name) return let_alfera_recommend;
  return { choose_model_by: 'use_this_exact_model', model_provider, model_proxy, model_name };
}

function list_schedule_rows(task: Trigger) {
  const timezone = string_shape_of(object_shape_of(task.trigger_config).timezone);
  return [
    ['Schedule', describe_task_schedule(task)],
    ...(timezone ? [['Time zone', timezone]] : []),
  ];
}

function describe_task_schedule(task: Trigger) {
  if (task.trigger_type === 'manual') return 'Manual';
  const run_once_at = string_shape_of(object_shape_of(task.trigger_config).run_once_at);
  if (!run_once_at) return describe_schedule(task.schedule_expression);
  const instant = new Date(run_once_at);
  if (Number.isNaN(instant.getTime())) return describe_schedule(task.schedule_expression);
  return instant.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  });
}

function object_shape_of(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function string_shape_of(value: unknown) {
  return typeof value === 'string' ? value : '';
}
