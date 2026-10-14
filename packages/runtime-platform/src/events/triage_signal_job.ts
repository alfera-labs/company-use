import {
  type Database,
  type event_jobs,
  event_jobs as event_jobs_table,
  type events,
} from '@coworker/core';
import { list_automations } from '@coworker/core/db/queries/automation_reads';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { queue_key_is_about_subject } from '@runtime-platform/automations/automation_subject';
import { judge_signal_for_triage } from '@runtime-platform/automations/triage_signal_verdict';
import { read_ignore_rules } from '@runtime-platform/notifications/default_ignore_rules';
import {
  read_notification_rules_file,
  read_notification_rules_guidance,
} from '@runtime-platform/notifications/notification_rules_file';
import { write_triage_notifications } from '@runtime-platform/notifications/triage_notifications';
import { apply_trigger_rules } from '@runtime-platform/triggers/trigger_rules';
import { and, count, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

const log = create_logger('triage_signal');
export const triage_signal_source = 'triage';
export const triage_signal_job_handler = 'triage_signal';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

const triage_signal_body_schema = z.strictObject({
  kind: z.literal('triage_signal'),
  agent_id: z.string().min(1),
  automation_id: z.string().min(1),
  trigger_id: z.string().min(1),
  stage: z.enum(['judge', 'listen']),
  fire_event_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

type TriageSignal = z.output<typeof triage_signal_body_schema>;

export async function run_triage_signal_job(input: {
  db: Database;
  workspace_id: string;
  event_jobs?: EventJob[];
  events: EventRecord[];
}): Promise<EventJobHandlerResult> {
  const signal = read_latest_triage_signal(input.events);
  if (!signal) return done({ triaged: false, code: 'no_signal' });
  const { db, workspace_id } = input;
  const who = { workspace_id, agent_id: signal.agent_id };

  const rules = apply_trigger_rules(await read_ignore_rules(db, who), signal.data);
  if (!rules.passed) {
    return done({ triaged: false, skipped: { stage: 'rule', reason: rules.reason } });
  }

  const subject = read_triage_subject(input.events);
  if (subject && (await another_automation_has_the_subject(db, workspace_id, subject))) {
    return done({
      triaged: false,
      skipped: { stage: 'handled', reason: 'an automation is already on this subject' },
    });
  }

  const { policy } = await read_notification_rules_file(db, who);
  const calls_today = await count_triage_calls_today(db, workspace_id);
  if (calls_today >= policy.triage_calls_per_day) {
    const reason = `${calls_today} signals were already triaged today (the limit is ${policy.triage_calls_per_day}).`;
    return done({ triaged: false, skipped: { stage: 'budget', reason } });
  }

  const verdict = await judge_signal_for_triage({
    workspace_id,
    guidance: await read_notification_rules_guidance(db, who),
    automation_names: await read_automation_names(db, who),
    data: signal.data,
  });
  if (!verdict) return done({ triaged: true, code: 'unreadable_verdict' });

  const said = await write_triage_notifications(db, {
    ...who,
    verdict,
    run_id: input.event_jobs?.[0]?.job_id ?? signal.fire_event_id,
    fire_event_id: signal.fire_event_id,
  });
  log.info('a signal nobody was watching was triaged', {
    workspace_id,
    important_now: verdict.important_now,
    could_automate: verdict.could_automate,
  });
  return done({ triaged: true, triage: { ...verdict, ...said } });
}

function done(result_data: Record<string, unknown>): EventJobHandlerResult {
  return { job_status: 'done', result_data };
}

function read_latest_triage_signal(records: EventRecord[]): TriageSignal | null {
  const signals = records
    .filter((record) => record.source === triage_signal_source)
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime());
  const latest = signals.at(-1);
  if (!latest) return null;
  const parsed = triage_signal_body_schema.safeParse(latest.event_body);
  if (!parsed.success) return null;
  return parsed.data;
}

async function read_automation_names(
  db: Database,
  input: { workspace_id: string; agent_id: string },
): Promise<string[]> {
  const automations = await list_automations(db, { ...input, limit: 50 });
  return automations.map((automation) => automation.automation_name);
}

async function count_triage_calls_today(db: Database, workspace_id: string): Promise<number> {
  const day_start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [row] = await db
    .select({ total: count() })
    .from(event_jobs_table)
    .where(
      and(
        eq(event_jobs_table.workspace_id, workspace_id),
        eq(event_jobs_table.job_handler, triage_signal_job_handler),
        gte(event_jobs_table.created_time, day_start),
        sql`${event_jobs_table.result_data} ->> 'triaged' = 'true'`,
      ),
    );
  return row?.total ?? 0;
}

function read_triage_subject(records: EventRecord[]): string | null {
  const key = records.at(-1)?.queue_key ?? '';
  const [, , ...rest] = key.split(':');
  const subject = rest.join(':');
  return subject.length > 0 ? subject : null;
}

async function another_automation_has_the_subject(
  db: Database,
  workspace_id: string,
  subject: string,
): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(event_jobs_table)
    .where(
      and(
        eq(event_jobs_table.workspace_id, workspace_id),
        eq(event_jobs_table.job_handler, 'run_automation'),
        queue_key_is_about_subject(event_jobs_table.queue_key, subject),
        or(
          inArray(event_jobs_table.job_status, ['queued', 'running', 'waiting']),
          sql`${event_jobs_table.result_data} ->> 'ran' = 'true'`,
        ),
      ),
    );
  return (row?.total ?? 0) > 0;
}
