import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import {
  let_alfera_recommend,
  type ModelChoice,
  written_message_model,
} from '@/components/app/model_picker/model_choice';
import type { ScheduledTaskFrequency } from '@/components/app/scheduled_task_when_to_run';
import type { SessionMessagePart, Trigger } from '@/lib/api';
import {
  cron_to_draft,
  default_schedule_draft,
  type ScheduleDraft,
} from '@/lib/schedule_builder_model';

export type ScheduledTaskEditorValue = {
  name: string;
  instruction: string;
  context_digest: string | null;
  agent_id: string | null;
  model_choice: ModelChoice;
  attachments: PendingChatAttachment[];
  preserved_content: unknown[];
  frequency: ScheduledTaskFrequency;
  draft: ScheduleDraft;
  advanced_cron: string | null;
  original_run_once_at: string | null;
  trigger_config: Record<string, unknown>;
};

export function empty_scheduled_task_value(): ScheduledTaskEditorValue {
  return {
    name: '',
    instruction: '',
    context_digest: null,
    agent_id: null,
    model_choice: let_alfera_recommend,
    attachments: [],
    preserved_content: [],
    frequency: 'every_day',
    draft: default_schedule_draft,
    advanced_cron: null,
    original_run_once_at: null,
    trigger_config: {},
  };
}

export function scheduled_task_value(task: Trigger): ScheduledTaskEditorValue {
  const trigger_config = record_shape_of(task.trigger_config);
  const job_input = record_shape_of(trigger_config.job_input);
  const content = Array.isArray(job_input.content) ? job_input.content : [];
  const run_once_at = string_shape_of(trigger_config.run_once_at);
  const parsed_draft = run_once_at
    ? run_once_to_draft(run_once_at)
    : cron_to_draft(task.schedule_expression ?? '');

  return {
    name: task.trigger_name,
    instruction: string_shape_of(job_input.instruction) ?? '',
    context_digest: Object.hasOwn(job_input, 'context_digest')
      ? (string_shape_of(job_input.context_digest) ?? '')
      : null,
    agent_id: task.agent_id ?? null,
    model_choice: read_model_choice(job_input),
    attachments: content.flatMap((part, index) => {
      const attachment = persisted_attachment(part, index);
      return attachment ? [attachment] : [];
    }),
    preserved_content: content.filter((part) => !is_attachment_part(part)),
    frequency: read_frequency(task, parsed_draft, run_once_at),
    draft: parsed_draft ?? default_schedule_draft,
    advanced_cron: run_once_at || parsed_draft ? null : (task.schedule_expression ?? null),
    original_run_once_at: run_once_at,
    trigger_config,
  };
}

export function build_scheduled_task_config(input: {
  base_config: Record<string, unknown>;
  instruction: string;
  context_digest: string | null;
  model_choice: ModelChoice;
  attachments: PendingChatAttachment[];
  preserved_content: unknown[];
  timezone: string;
  run_once_at: string | null;
}) {
  const existing_job_input = record_shape_of(input.base_config.job_input);
  const {
    instruction: _instruction,
    context_digest: _context_digest,
    model_name: _model_name,
    model_provider: _model_provider,
    model_proxy: _model_proxy,
    content: _content,
    ...other_job_input
  } = existing_job_input;
  const { run_once_at: _run_once_at, one_time: _one_time, ...other_config } = input.base_config;
  const content = [
    ...input.preserved_content,
    ...input.attachments.flatMap((attachment) => (attachment.part ? [attachment.part] : [])),
  ];

  return {
    ...other_config,
    starts_job_handler: other_config.starts_job_handler ?? 'run_scheduled_agent_task',
    timezone: string_shape_of(other_config.timezone) ?? input.timezone,
    job_input: {
      ...other_job_input,
      instruction: input.instruction.trim(),
      ...written_message_model(input.model_choice),
      ...(input.context_digest === null
        ? {}
        : input.context_digest.trim()
          ? { context_digest: input.context_digest.trim() }
          : {}),
      ...(content.length ? { content } : {}),
    },
    ...(input.run_once_at ? { run_once_at: input.run_once_at, one_time: true } : {}),
  };
}

function read_frequency(
  task: Trigger,
  draft: ScheduleDraft | null,
  run_once_at: string | null,
): ScheduledTaskFrequency {
  if (task.trigger_type === 'manual') return 'manual';
  if (run_once_at) return 'run_once';
  if (!draft) return 'custom';
  if (draft.frequency === 'daily') return 'every_day';
  if (draft.frequency === 'hourly') return 'every_hour';
  if (draft.frequency === 'interval') return 'interval';
  if (draft.frequency === 'monthly') return 'every_month';
  if (draft.frequency === 'weekly' && draft.weekdays.join(',') === '1,2,3,4,5') {
    return 'every_weekday';
  }
  if (draft.frequency === 'weekly' && draft.weekdays.length === 1) return 'every_week';
  return 'selected_days';
}

function run_once_to_draft(run_once_at: string): ScheduleDraft | null {
  const instant = new Date(run_once_at);
  if (Number.isNaN(instant.getTime())) return null;
  return {
    ...default_schedule_draft,
    frequency: 'once',
    once_date: `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`,
    hour: instant.getHours(),
    minute: instant.getMinutes(),
  };
}

function read_model_choice(job_input: Record<string, unknown>): ModelChoice {
  const model_provider = string_shape_of(job_input.model_provider);
  const model_proxy = string_shape_of(job_input.model_proxy);
  const model_name = string_shape_of(job_input.model_name);
  if (!model_provider || !model_proxy || !model_name) return let_alfera_recommend;
  return { choose_model_by: 'use_this_exact_model', model_provider, model_proxy, model_name };
}

function persisted_attachment(value: unknown, index: number): PendingChatAttachment | null {
  if (!is_attachment_part(value)) return null;
  const name =
    value.type === 'image'
      ? (value.source ?? `Image ${index + 1}`)
      : (value.name ?? `File ${index + 1}`);
  const mime_type = value.mime_type ?? 'application/octet-stream';
  return {
    id: `persisted-${index}`,
    name,
    mime_type,
    byte_size:
      value.type === 'image' ? Math.floor(value.data.length * 0.75) : (value.text?.length ?? 0),
    upload_status: 'ready',
    upload_progress: 1,
    part: value,
  };
}

function is_attachment_part(
  value: unknown,
): value is Exclude<SessionMessagePart, { type: 'text' }> {
  if (!value || typeof value !== 'object') return false;
  const part = value as Record<string, unknown>;
  if (part.type === 'file') return true;
  return (
    part.type === 'image' && typeof part.data === 'string' && typeof part.mime_type === 'string'
  );
}

function record_shape_of(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string_shape_of(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
