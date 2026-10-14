import {
  build_scheduled_task_run_authority,
  type Database,
  type event_jobs,
  type events,
} from '@coworker/core';
import type {} from '@coworker/core/db/queries/events';
import { find_last_user_activity_time } from '@coworker/core/db/queries/sessions';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { mark_trigger_completed } from '@coworker/core/db/queries/trigger_writes';
import type { EventJobHandlerResult } from '@coworker/jobs';
import {
  agent_heartbeat_config_key,
  message_file_part_schema,
  message_image_part_schema,
  message_text_part_schema,
  model_name_schema,
  model_provider_schema,
  model_proxy_schema,
} from '@coworker/shared';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import { open_scheduled_task_chat } from '@runtime-platform/events/scheduled_task_chat';
import { build_scheduled_task_source_metadata } from '@runtime-platform/events/scheduled_task_source_metadata';
import { read_trigger_schedule } from '@runtime-platform/events/trigger_ingress';
import { find_why_task_people_left } from '@runtime-platform/events/trigger_member_gate';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { message_content_to_runtime_parts } from '@runtime-platform/orchestrator/runtime_message_content';
import { get_scout_source_metadata } from '@runtime-platform/tools/policies/scout_source_metadata';
import { z } from 'zod';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

const scheduled_task_actor = 'system:trigger';

const system_trigger_model = { model_proxy: 'anthropic', model_name: 'claude-haiku-4.5' };

const scheduled_task_fire_schema = z
  .object({
    trigger_id: z.string().min(1),
    instruction: z.string().min(1).optional(),
    context_digest: z.string().optional(),
    content: z
      .array(
        z.discriminatedUnion('type', [
          message_text_part_schema,
          message_image_part_schema,
          message_file_part_schema,
        ]),
      )
      .max(20)
      .optional(),
    model_provider: model_provider_schema.optional(),
    model_proxy: model_proxy_schema.optional(),
    model_name: model_name_schema.optional(),
  })
  .passthrough();

type ScheduledAgentTaskJobInput = {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_scheduled_agent_task_job(
  input: ScheduledAgentTaskJobInput,
): Promise<EventJobHandlerResult> {
  const fire = read_latest_trigger_fire(input.events);
  if (!fire) return skipped_result('No trigger.fired event was available.');

  const trigger = await get_trigger_by_id(input.db, fire.trigger_id);
  if (!trigger) return skipped_result(`Trigger ${fire.trigger_id} no longer exists.`, 'no_trigger');

  const scout_source = get_scout_source_metadata(trigger.trigger_source);
  const task_instruction = fire.instruction ?? default_instruction(trigger.trigger_name);
  const delegated_authority = build_scheduled_task_run_authority(
    trigger.trigger_id,
    trigger.trigger_source,
    task_instruction,
  );
  const instruction = build_run_instruction(
    task_instruction,
    scout_source,
    Boolean(delegated_authority),
    fire.context_digest,
  );
  const source_metadata = await build_scheduled_task_source_metadata(input.db, trigger, {
    ...(scout_source ?? {}),
    ...(delegated_authority ?? {}),
  });

  const finished_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
  });
  if (finished_run) {
    if (read_trigger_schedule(trigger)?.run_once_at) {
      await mark_trigger_completed(input.db, trigger.trigger_id);
    }
    return {
      job_status: 'done',
      run_id: finished_run.run_id,
      result_data: {
        trigger_id: trigger.trigger_id,
        session_id: finished_run.session_id,
        run_id: finished_run.run_id,
        recovered_started_run: true,
      },
    };
  }

  const idle_skip = await system_trigger_idle_skip(input.db, input.workspace_id, trigger);
  if (idle_skip) return skipped_result(idle_skip, 'system_trigger_idle_skipped');
  const left = await find_why_task_people_left(input.db, trigger);
  if (left) return skipped_result(left, 'task_of_a_person_who_left');

  const session = await open_scheduled_task_chat(input.db, trigger, source_metadata);

  const run = await start_agent_run_for_job(
    input.db,
    {
      workspace_id: input.workspace_id,
      session_id: session.session_id,
      user_content: [
        { type: 'text', text: instruction },
        ...message_content_to_runtime_parts({ type: 'multimodal', parts: fire.content ?? [] }),
      ],
      source_type: 'runtime',
      user_message_source_metadata: source_metadata,
      trigger_type: 'schedule',
      trigger_id: trigger.trigger_id,
      actor_id: scheduled_task_actor,
      ...(fire.model_provider ? { model_provider: fire.model_provider } : {}),
      ...(fire.model_proxy ? { model_proxy: fire.model_proxy } : {}),
      ...(fire.model_name ? { model_name: fire.model_name } : {}),
      ...(trigger.trigger_source?.kind === 'system' ? system_trigger_model : {}),
    },
    read_agent_run_job(input),
  );

  if (read_trigger_schedule(trigger)?.run_once_at) {
    await mark_trigger_completed(input.db, trigger.trigger_id);
  }

  return {
    job_status: 'done',
    run_id: run.run_id,
    result_data: {
      trigger_id: trigger.trigger_id,
      session_id: session.session_id,
      run_id: run.run_id,
    },
  };
}

const system_trigger_weekly_after_idle_days = 7;
const system_trigger_pause_after_idle_days = 30;

export async function system_trigger_idle_skip(
  db: Database,
  workspace_id: string,
  trigger: { trigger_source: Record<string, unknown> | null },
  now = new Date(),
) {
  if (trigger.trigger_source?.kind !== 'system') return null;
  const last_activity = await find_last_user_activity_time(db, workspace_id);
  if (!last_activity) return 'workspace has no user activity and no creation time';
  const idle_days = (now.getTime() - last_activity.getTime()) / 86_400_000;
  if (idle_days < system_trigger_weekly_after_idle_days) return null;
  if (idle_days > system_trigger_pause_after_idle_days) {
    return `paused: no user activity for ${Math.floor(idle_days)} days`;
  }
  if (now.getUTCDay() === 1) return null;
  return `weekly backoff: no user activity for ${Math.floor(idle_days)} days`;
}

function read_latest_trigger_fire(records: EventRecord[]) {
  const fires = records
    .filter((record) => record.source === 'trigger')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime());
  const latest = fires.at(-1);
  if (!latest) return null;

  const parsed = scheduled_task_fire_schema.safeParse(latest.event_body);
  return parsed.success ? parsed.data : null;
}

function default_instruction(trigger_name: string) {
  return `Run the scheduled task "${trigger_name}".`;
}

function build_run_instruction(
  instruction: string,
  source_metadata: ReturnType<typeof get_scout_source_metadata>,
  was_authorized: boolean,
  context_digest?: string,
) {
  const run_instruction = [
    instruction,
    ...(context_digest
      ? ['', 'Background from when this task was scheduled:', context_digest]
      : []),
    ...(was_authorized
      ? [
          '',
          'This task was authorized when it was scheduled. Execute it now without asking for the same confirmation again. Stay within the scheduled instruction.',
        ]
      : []),
  ];
  const source_event_id = source_metadata?.[agent_heartbeat_config_key].source_event_id;
  if (!source_event_id) return run_instruction.join('\n');
  return [
    ...run_instruction,
    '',
    `This task came from Slack event ${source_event_id}.`,
    'Read that exact source thread again before delivering anything.',
    `Every slack-send_message-1 or slack-upload_file-1 call must include source_event_id: "${source_event_id}".`,
    'If the source was answered or delivery is rejected, finish without sending another message.',
  ].join('\n');
}

function skipped_result(message: string, code = 'scheduled_task_skipped'): EventJobHandlerResult {
  return { job_status: 'done', result_data: { ran: false, code, message } };
}
