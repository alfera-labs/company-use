import type {
  AutomationFire,
  AutomationFireSkipStage,
  FireRow,
} from '@coworker/core/db/queries/automation_fire_types';
import { z } from 'zod';

export type {
  AutomationFire,
  AutomationFireOutcome,
  AutomationFireSkipStage,
  AutomationFireTold,
  FireRow,
} from '@coworker/core/db/queries/automation_fire_types';

const skip_stage_by_written_stage: Record<string, AutomationFireSkipStage> = {
  rule: 'rule',
  ear_rule: 'rule',
  judge: 'judge',
  human: 'human',
  listen: 'listen',
};

export function read_automation_fire(row: FireRow): AutomationFire {
  const result = fire_result_schema.parse(row.result_data ?? {});
  const identity = {
    event_id: row.event_id,
    fired_time: row.fired_time,
    trigger_id: row.trigger_id,
    trigger_name: row.trigger_name,
    run_id: row.run_id ?? result.run_id,
    session_id: result.session_id ?? row.run_session_id ?? null,
    subject_source: result.subject_source,
    triage: read_triage(row.triage_result),
    told: null,
    skipped: null,
    judge: read_judge_numbers(result.judge),
    budget_limit: null,
  };

  if (row.job_status === null) {
    return { ...identity, outcome: 'didnt_fire', reason: 'No automation job was queued for this.' };
  }
  if (row.job_status === 'failed') {
    return {
      ...identity,
      outcome: 'didnt_fire',
      reason: optional_text.parse(row.error_data?.message),
    };
  }
  if (row.job_status !== 'done')
    return { ...identity, outcome: read_unfinished_outcome(row), reason: null };
  if (result.ran) return { ...identity, outcome: 'fired', reason: null };
  if (result.skipped) {
    return {
      ...identity,
      outcome: 'skipped',
      reason: skip_words(result.skipped, result.judge),
      skipped: read_skip(result.skipped),
    };
  }
  return {
    ...identity,
    outcome: 'didnt_fire',
    reason: result.message,
    budget_limit: result.budget_limit,
  };
}

function read_unfinished_outcome(row: FireRow): 'running' | 'waiting' {
  if (row.run_status === 'waiting') return 'waiting';
  return row.job_status === 'running' || row.run_status === 'running' ? 'running' : 'waiting';
}

const optional_text = z
  .string()
  .catch('')
  .transform((value) => (value.trim() ? value : null));

const skip_schema = z
  .object({ stage: optional_text, reason: optional_text })
  .catch({ stage: null, reason: null })
  .transform((skip) =>
    skip.stage && skip.reason ? { stage: skip.stage, reason: skip.reason } : null,
  );

const judge_schema = z
  .object({
    confidence: z.number().nullable().catch(null),
    threshold: z.number().nullable().catch(null),
    reason: optional_text,
  })
  .nullable()
  .catch(null);

const fire_result_schema = z.object({
  ran: z.boolean().catch(false),
  message: optional_text,
  run_id: optional_text,
  session_id: optional_text,
  subject_source: optional_text,
  skipped: skip_schema,
  judge: judge_schema,
  budget_limit: z.number().int().positive().nullable().catch(null),
});

const triage_result_schema = z.object({
  skipped: skip_schema,
  triage: z
    .object({
      important_now: z.unknown().transform((value) => String(value)),
      claim: optional_text,
    })
    .nullable()
    .catch(null),
});

type Judge = z.infer<typeof judge_schema>;
type Skip = NonNullable<z.infer<typeof skip_schema>>;

function read_skip(skip: Skip): AutomationFire['skipped'] {
  const stage = skip_stage_by_written_stage[skip.stage];
  return stage ? { stage, reason: remove_judge_arithmetic(skip.reason) } : null;
}

function remove_judge_arithmetic(reason: string): string {
  const words = reason.replace(/^\d+(\.\d+)? < \d+(\.\d+)?: /, '');
  return /^jev p\(yes\)=[\d.]+$/.test(words) ? 'The event does not fit the question.' : words;
}

function read_judge_numbers(judge: Judge): AutomationFire['judge'] {
  if (judge?.confidence == null || judge.threshold == null) return null;
  return { confidence: judge.confidence, threshold: judge.threshold };
}

function read_triage(result_data: Record<string, unknown> | null | undefined): string | null {
  if (!result_data) return null;
  const { skipped, triage } = triage_result_schema.parse(result_data);
  if (skipped) return `${skipped.stage}: ${skipped.reason}`;
  if (!triage) return null;
  return `important ${triage.important_now}: ${triage.claim ?? ''}`;
}

function skip_words(skip: Skip, judge: Judge): string {
  const confidence = judge?.confidence === null ? '' : ` ${judge?.confidence}`;
  return `${skip.stage}${judge ? confidence : ''}: ${skip.reason}`;
}
