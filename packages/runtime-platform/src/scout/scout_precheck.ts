import { type Database, event_jobs, events, triggers } from '@coworker/core';
import { choices_answer_event_type } from '@coworker/core/db/queries/choices_answers';
import {
  policy_decision_event_type,
  policy_decision_job_handler,
} from '@coworker/core/db/queries/event_waits';
import { and, count, eq, gte, lt, ne, or, sql } from 'drizzle-orm';

export type ScoutSignalCounts = {
  new_signals: number;
  newly_due_automations: number;
  new_held_approvals: number;
  new_questions_asked: number;
};

export function anything_new(counts: ScoutSignalCounts) {
  return Object.values(counts).some((value) => value > 0);
}

export async function count_signals_since_last_look(
  db: Database,
  input: { workspace_id: string; trigger_id: string; since: Date; now: Date },
): Promise<ScoutSignalCounts> {
  const [new_signals, newly_due_automations, new_held_approvals, new_questions_asked] =
    await Promise.all([
      count_rows(
        db
          .select({ rows: count() })
          .from(events)
          .where(
            and(
              eq(events.workspace_id, input.workspace_id),
              gte(events.created_time, input.since),
              or(ne(events.source, 'trigger'), sql`${events.event_body} -> 'delivery' is not null`),
            ),
          ),
      ),
      count_rows(
        db
          .select({ rows: count() })
          .from(triggers)
          .where(
            and(
              eq(triggers.workspace_id, input.workspace_id),
              eq(triggers.trigger_status, 'enabled'),
              ne(triggers.trigger_id, input.trigger_id),
              gte(triggers.next_run_time, input.since),
              lt(triggers.next_run_time, input.now),
            ),
          ),
      ),
      count_new_waits(db, input, policy_decision_event_type),
      count_new_waits(db, input, choices_answer_event_type),
    ]);
  return { new_signals, newly_due_automations, new_held_approvals, new_questions_asked };
}

function count_new_waits(
  db: Database,
  input: { workspace_id: string; since: Date },
  awaits_event_type: string,
) {
  return count_rows(
    db
      .select({ rows: count() })
      .from(event_jobs)
      .where(
        and(
          eq(event_jobs.workspace_id, input.workspace_id),
          eq(event_jobs.job_handler, policy_decision_job_handler),
          eq(event_jobs.job_status, 'waiting'),
          eq(event_jobs.awaits_event_type, awaits_event_type),
          gte(event_jobs.created_time, input.since),
        ),
      ),
  );
}

async function count_rows(query: Promise<{ rows: number }[]>) {
  const [row] = await query;
  return row?.rows ?? 0;
}
