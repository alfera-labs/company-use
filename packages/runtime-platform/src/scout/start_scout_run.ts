import type { Database, event_jobs } from '@coworker/core';
import type {} from '@coworker/core/db/queries/events';
import { find_or_create_session_for_external_thread } from '@coworker/core/db/queries/sessions';
import type { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import type { EventJobHandlerResult } from '@coworker/jobs';
import {
  ConflictError,
  format_error_message,
  scout_actor,
  scout_config_key,
  scout_session_kind,
  scout_session_thread_prefix,
} from '@coworker/shared';
import { read_notification_rules_guidance } from '@runtime-platform/notifications/notification_rules_file';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { list_upcoming_calendar_events } from '@runtime-platform/scout/scout_calendar';
import type { collect_scout_context } from '@runtime-platform/scout/scout_context';
import { completed_result, failed_result } from '@runtime-platform/scout/scout_job_results';
import { build_scout_prompt } from '@runtime-platform/scout/scout_prompt';
import type { ScoutConfig } from '@runtime-platform/scout/scout_trigger_config';
import type { list_open_slack_activity } from '@runtime-platform/scout/slack_activity';
import {
  build_scout_user_content,
  prepare_scout_attachments,
} from '@runtime-platform/scout/slack_attachments';

type ScoutTrigger = NonNullable<Awaited<ReturnType<typeof get_trigger_by_id>>>;

export type ScoutRunInput = {
  db: Database;
  workspace_id: string;
  now?: Date;
  event_jobs?: (typeof event_jobs.$inferSelect)[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function prepare_scout_agent_run(
  input: ScoutRunInput,
  trigger: ScoutTrigger,
  config: ScoutConfig,
  activity: Awaited<ReturnType<typeof list_open_slack_activity>>,
  context: Awaited<ReturnType<typeof collect_scout_context>>,
) {
  const attachment_context = await prepare_scout_attachments(
    input.db,
    input.workspace_id,
    activity,
  );
  const attention_guidance = await read_notification_rules_guidance(input.db, {
    workspace_id: input.workspace_id,
    agent_id: trigger.agent_id,
  });
  const session = await find_or_create_session_for_external_thread(input.db, {
    workspace_id: input.workspace_id,
    agent_id: trigger.agent_id,
    session_source: 'trigger',
    external_thread_key: `${scout_session_thread_prefix}:${trigger.trigger_id}`,
    session_title: trigger.trigger_name,
    source_metadata: {
      trigger_id: trigger.trigger_id,
      kind: scout_session_kind,
      runtime_response_is_user_visible: false,
    },
    actor_id: scout_actor,
  });
  const prompt = build_scout_prompt({
    attention_guidance,
    trigger,
    activity: attachment_context.activity,
    context: {
      ...context,
      upcoming_events:
        (await list_upcoming_calendar_events(input.db, {
          workspace_id: input.workspace_id,
          session_id: session.session_id,
          ...(input.now ? { now: input.now } : {}),
        })) ?? [],
    },
    max_actions: config.max_actions,
    ...(input.now ? { now: input.now } : {}),
    ...(config.mode === 'autonomous_agent' && config.instruction
      ? { instruction: config.instruction }
      : {}),
  });
  return {
    session,
    prompt,
    attachment_sources: attachment_context.sources,
    observed_event_ids: activity.map((message) => message.event_id),
  };
}

export async function start_scout_agent_run(
  input: ScoutRunInput,
  trigger: ScoutTrigger,
  config: ScoutConfig,
  scout_run: Awaited<ReturnType<typeof prepare_scout_agent_run>>,
): Promise<EventJobHandlerResult> {
  try {
    const run = await start_agent_run_for_job(
      input.db,
      {
        workspace_id: input.workspace_id,
        session_id: scout_run.session.session_id,
        user_message: scout_run.prompt,
        user_content: build_scout_user_content(scout_run.prompt, scout_run.attachment_sources),
        attachment_sources: scout_run.attachment_sources,
        source_type: 'runtime',
        user_message_source_metadata: {
          trigger_id: trigger.trigger_id,
          [scout_config_key]: {
            version: config.version,
            mode: 'autonomous_agent',
            observed_event_ids: scout_run.observed_event_ids,
          },
        },
        trigger_type: 'schedule',
        trigger_id: trigger.trigger_id,
        actor_id: scout_actor,
        max_output_tokens: config.max_output_tokens,
        user_message_is_user_visible: false,
        runtime_response_is_user_visible: false,
      },
      read_agent_run_job(input),
    );

    return completed_result({
      trigger_id: trigger.trigger_id,
      session_id: scout_run.session.session_id,
      run_id: run.run_id,
      observed_event_ids: scout_run.observed_event_ids,
      recovered_started_run: false,
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    return failed_result('scout_run_failed', format_error_message(error, 'Scout job failed.'), {
      trigger_id: trigger.trigger_id,
      session_id: scout_run.session.session_id,
    });
  }
}
