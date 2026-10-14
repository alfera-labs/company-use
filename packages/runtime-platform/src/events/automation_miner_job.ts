import type { Database, event_jobs, events } from '@coworker/core';
import { list_automations } from '@coworker/core/db/queries/automation_reads';
import type {} from '@coworker/core/db/queries/events';
import { list_human_asks } from '@coworker/core/db/queries/mined_asks';
import { list_dismissed_notification_fingerprints } from '@coworker/core/db/queries/notification_outcomes';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import {
  read_fired_system_trigger,
  system_job_skipped,
} from '@runtime-platform/events/system_trigger_fire';
import {
  ask_is_already_automated,
  group_recurring_asks,
  type RecurringAsk,
} from '@runtime-platform/miner/group_recurring_asks';
import { read_automation_proposal } from '@runtime-platform/miner/read_automation_proposal';
import { notification_fingerprint } from '@runtime-platform/notifications/notification_body';
import { write_notification } from '@runtime-platform/notifications/write_notification';

const log = create_logger('automation_miner');
const miner_actor = 'system:automation_miner';
const look_back_weeks = 6;
const refusal_holds_weeks = 8;
const ideas_per_pass = 3;
const ask_row_limit = 500;
export const recurring_ask_claim = 'keeps being asked by hand';

type MinerJobInput = {
  db: Database;
  workspace_id: string;
  events: (typeof events.$inferSelect)[];
  event_jobs?: (typeof event_jobs.$inferSelect)[];
  now?: Date;
};

export async function run_automation_miner_job(
  input: MinerJobInput,
): Promise<EventJobHandlerResult> {
  const fire = await read_fired_system_trigger(input.db, input.events);
  if (!fire) return system_job_skipped('No system trigger fire was available.', 'no_trigger');
  const now = input.now ?? new Date();

  const asks = await list_human_asks(input.db, {
    workspace_id: input.workspace_id,
    since: weeks_before(now, look_back_weeks),
    limit: ask_row_limit,
  });
  const recurring = group_recurring_asks(asks);
  if (recurring.length === 0) {
    return system_job_skipped('Nothing was asked three times over three weeks.', 'no_candidates');
  }

  const candidates = await drop_the_ones_already_answered(input.db, {
    workspace_id: input.workspace_id,
    recurring,
    now,
  });
  if (candidates.length === 0) {
    return system_job_skipped('Every recurring ask is covered or refused.', 'no_new_candidates');
  }

  const pitched: { ask_key: string; outcome: string; automation_sentence: string }[] = [];
  for (const candidate of candidates.slice(0, ideas_per_pass)) {
    const idea = await pitch_one_habit(input.db, {
      workspace_id: input.workspace_id,
      agent_id: fire.trigger.agent_id,
      run_id: input.event_jobs?.[0]?.job_id ?? fire.event.event_id,
      candidate,
      now,
    });
    if (idea) pitched.push(idea);
  }

  log.info('the miner read six weeks of asks', {
    workspace_id: input.workspace_id,
    asks: asks.length,
    recurring: recurring.length,
    pitched: pitched.length,
  });
  return {
    job_status: 'done',
    result_data: { ran: true, asks_read: asks.length, candidates: candidates.length, pitched },
  };
}

async function drop_the_ones_already_answered(
  db: Database,
  input: { workspace_id: string; recurring: RecurringAsk[]; now: Date },
) {
  const [automations, refused] = await Promise.all([
    list_automations(db, {
      workspace_id: input.workspace_id,
      automation_statuses: ['enabled'],
    }),
    list_dismissed_notification_fingerprints(db, {
      workspace_id: input.workspace_id,
      since: weeks_before(input.now, refusal_holds_weeks),
    }),
  ]);
  const instructions = automations.map((automation) => automation.instruction);

  return input.recurring.filter(
    (candidate) =>
      !ask_is_already_automated(candidate.normalized_ask, instructions) &&
      !refused.has(fingerprint_of(input.workspace_id, candidate)),
  );
}

export function mined_ask_subject(normalized_ask: string) {
  return `recurring ask: ${normalized_ask}`.slice(0, 200);
}

function fingerprint_of(workspace_id: string, candidate: RecurringAsk) {
  return notification_fingerprint(workspace_id, {
    subject: mined_ask_subject(candidate.normalized_ask),
    claim: recurring_ask_claim,
  });
}

async function pitch_one_habit(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    run_id: string;
    candidate: RecurringAsk;
    now: Date;
  },
) {
  const proposal = await read_automation_proposal({
    workspace_id: input.workspace_id,
    candidate: input.candidate,
  });
  if (!proposal) return null;

  const { candidate } = input;
  const written = await write_notification(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    actor_id: miner_actor,
    written_by: 'platform',
    only_the_principal_reads: true,
    now: input.now,
    notification: {
      run_id: input.run_id,
      principal_id: candidate.asked_by,
      subject: mined_ask_subject(candidate.normalized_ask),
      claim: recurring_ask_claim,
      title: `You asked for this ${candidate.ask_count} times in ${candidate.distinct_weeks} weeks`,
      body: idea_body(candidate, proposal.automation_sentence, proposal.cron_or_node_key),
      urgency: 'fyi',
      evidence: { run_ids: candidate.run_ids.slice(0, 5) },
      proposed_action: { kind: 'create_automation', instruction: proposal.automation_sentence },
      score: 45,
      reason: `the same request came ${candidate.ask_count} times across ${candidate.distinct_weeks} weeks`,
    },
  });
  return {
    ask_key: candidate.ask_key,
    outcome: written.outcome,
    automation_sentence: proposal.automation_sentence,
  };
}

function idea_body(candidate: RecurringAsk, sentence: string, hint: string | null) {
  return [
    `You have asked for this by hand ${candidate.ask_count} times since ${candidate.first_asked.toISOString().slice(0, 10)}. It could run on its own:`,
    sentence,
    hint
      ? `Suggested start: ${hint}.`
      : 'It does not say when this should start — the chat will ask.',
    `Your own words:\n${candidate.example_asks.map((ask) => `- ${ask}`).join('\n')}`,
  ].join('\n\n');
}

function weeks_before(now: Date, weeks: number) {
  return new Date(now.getTime() - weeks * 7 * 86_400_000);
}
