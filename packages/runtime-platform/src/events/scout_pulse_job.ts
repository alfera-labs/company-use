import type { Database, event_jobs, events } from '@coworker/core';
import type { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { find_finished_event_job_run } from '@runtime-platform/events/event_job_started_run';
import { notify_scout_observers } from '@runtime-platform/events/scout_observers';
import {
  decide_scout_cadence,
  find_last_scout_run_time,
} from '@runtime-platform/scout/scout_cadence';
import { collect_scout_context } from '@runtime-platform/scout/scout_context';
import {
  completed_result,
  failed_result,
  skipped_result,
} from '@runtime-platform/scout/scout_job_results';
import {
  anything_new,
  count_signals_since_last_look,
} from '@runtime-platform/scout/scout_precheck';
import {
  read_scout_config,
  read_scout_trigger,
  type ScoutConfig,
} from '@runtime-platform/scout/scout_trigger_config';
import { list_open_slack_activity } from '@runtime-platform/scout/slack_activity';
import {
  prepare_scout_agent_run,
  start_scout_agent_run,
} from '@runtime-platform/scout/start_scout_run';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;
type ScoutTrigger = NonNullable<Awaited<ReturnType<typeof get_trigger_by_id>>>;

type ScoutPulseJobInput = {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
  now?: Date;
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_scout_pulse_job(
  input: ScoutPulseJobInput,
): Promise<EventJobHandlerResult> {
  const trigger_result = await read_scout_trigger(input.db, input.events);
  if (!trigger_result.ok) return trigger_result.result;
  const trigger = trigger_result.trigger;

  await notify_scout_observers(input.db, input.workspace_id);

  const config_result = read_scout_config(trigger.trigger_config);
  if (!config_result.ok) {
    return failed_result('scout_config_invalid', config_result.message, {
      trigger_id: trigger.trigger_id,
    });
  }
  const finished_run = await find_finished_event_job_run(input.db, {
    workspace_id: input.workspace_id,
    event_jobs: input.event_jobs ?? [],
  });
  if (finished_run) {
    return completed_result({
      trigger_id: trigger.trigger_id,
      session_id: finished_run.session_id,
      run_id: finished_run.run_id,
      observed_event_ids: [],
      recovered_started_run: true,
    });
  }

  const cadence = await decide_scout_cadence(input.db, {
    workspace_id: input.workspace_id,
    agent_id: trigger.agent_id,
    trigger_id: trigger.trigger_id,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!cadence.should_run) return skipped_result(cadence.message, cadence.code);

  const last_look = await find_last_scout_run_time(input.db, {
    workspace_id: input.workspace_id,
    trigger_id: trigger.trigger_id,
  });
  if (last_look && !cadence.weekly_review) {
    const checked = await count_signals_since_last_look(input.db, {
      workspace_id: input.workspace_id,
      trigger_id: trigger.trigger_id,
      since: last_look,
      now: input.now ?? new Date(),
    });
    if (!anything_new(checked)) {
      return skipped_result(
        'Nothing new since the last look: no signals, no automation went past due, no approval is waiting.',
        'nothing_new',
        { skipped: 'nothing_new', checked },
      );
    }
  }

  return look_and_report(input, trigger, config_result.config, cadence.weekly_review, last_look);
}

async function look_and_report(
  input: ScoutPulseJobInput,
  trigger: ScoutTrigger,
  config: ScoutConfig,
  weekly_review: boolean,
  last_look: Date | null,
): Promise<EventJobHandlerResult> {
  const [activity, context] = await Promise.all([
    list_open_slack_activity(input.db, {
      workspace_id: input.workspace_id,
      limit: config.recent_message_limit,
      ...(input.now ? { now: input.now } : {}),
    }),
    collect_scout_context(input.db, {
      workspace_id: input.workspace_id,
      agent_id: trigger.agent_id,
      review_automations: weekly_review,
      ...(input.now ? { now: input.now } : {}),
    }),
  ]);
  const unseen_signals = context.recent_signals.filter(
    (signal) =>
      signal.source !== 'slack' && (!last_look || new Date(signal.created_time) > last_look),
  );
  if (
    activity.length === 0 &&
    context.open_loops.length === 0 &&
    unseen_signals.length === 0 &&
    context.automation_review.length === 0
  ) {
    return skipped_result(
      'No unanswered activity, no open loops, and nothing new since the last look.',
      'no_open_activity',
    );
  }

  const scout_run = await prepare_scout_agent_run(input, trigger, config, activity, context);
  return start_scout_agent_run(input, trigger, config, scout_run);
}
