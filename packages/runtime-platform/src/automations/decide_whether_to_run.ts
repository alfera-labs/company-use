import type { Database } from '@coworker/core';
import type {
  AutomationConditions,
  AutomationJudge,
} from '@coworker/core/db/schema/automation_contracts';
import { read_notification_rules_file } from '@runtime-platform/notifications/notification_rules_file';
import {
  judge_trigger_event,
  type TriggerJudgeVerdict,
} from '@runtime-platform/triggers/trigger_judge';
import { apply_trigger_rules } from '@runtime-platform/triggers/trigger_rules';

type RunSkip = { stage: 'rule' | 'judge'; reason: string };

type JudgedVerdict = TriggerJudgeVerdict & { threshold: number | null };

export type RunDecision = {
  runs: boolean;
  verdict: JudgedVerdict | null;
  skipped?: RunSkip;
};

/**
 * Decides whether one event starts a run: the rules first, then the judge's yes-or-no question.
 * On purpose, a judge that cannot be read lets the run happen (`confidence === null`). An event
 * that is dropped in silence is work the person never learns they missed, and the run that
 * starts instead is still held by every approval gate. The verdict keeps the reason, so the run
 * shows that nobody judged it. A provider failure is another case: it is thrown, and the job
 * tries again.
 */
export async function decide_whether_to_run(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    automation_id?: string | undefined;
    conditions: AutomationConditions | null | undefined;
    judge: AutomationJudge | undefined;
    data: Record<string, unknown>;
  },
): Promise<RunDecision> {
  const rules = apply_trigger_rules(input.conditions ?? [], input.data);
  if (!rules.passed) {
    return { runs: false, verdict: null, skipped: { stage: 'rule', reason: rules.reason } };
  }

  const question = input.judge?.question;
  if (!question) return { runs: true, verdict: null };

  const verdict = await judge_trigger_event({
    workspace_id: input.workspace_id,
    question,
    data: input.data,
  });
  if (verdict.confidence === null) return { runs: true, verdict: { ...verdict, threshold: null } };
  const threshold = as_a_fraction(
    input.judge?.run_at_or_above ??
      (await read_default_judge_threshold(db, input.workspace_id, input.agent_id)),
  );
  const judged = { ...verdict, threshold };
  if (verdict.confidence >= threshold) return { runs: true, verdict: judged };
  return {
    runs: false,
    verdict: judged,
    skipped: { stage: 'judge', reason: explain_judge_skip(verdict, verdict.confidence) },
  };
}

const not_sure_enough = 'Likely, but not sure enough to run.';

function explain_judge_skip(verdict: TriggerJudgeVerdict, probability_of_yes: number) {
  const leaned_yes = verdict.answer === null ? probability_of_yes >= 0.5 : verdict.answer === 'yes';
  return leaned_yes ? not_sure_enough : verdict.reason;
}

const judge_threshold_by_dial: Record<string, number | undefined> = {
  quiet: 0.9,
  normal: 0.8,
  eager: 0.6,
};
const default_judge_threshold = 0.8;

async function read_default_judge_threshold(
  db: Database,
  workspace_id: string,
  agent_id: string,
): Promise<number> {
  const { policy } = await read_notification_rules_file(db, { workspace_id, agent_id });
  return judge_threshold_by_dial[policy.dial] ?? default_judge_threshold;
}

function as_a_fraction(threshold: number) {
  return threshold > 1 ? threshold / 100 : threshold;
}
