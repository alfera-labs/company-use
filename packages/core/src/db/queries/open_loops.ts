import type { Database } from '@coworker/core/db/connection';
import { list_open_notifications } from '@coworker/core/db/queries/notification_outcomes';
import { list_open_loops_waiting_on_a_person } from '@coworker/core/db/queries/open_loops_waiting_on_a_person';
import { automations, run_messages, runs, triggers } from '@coworker/core/db/schema';
import { and, desc, eq, gte, isNotNull, lt } from 'drizzle-orm';

type OpenLoopKind =
  | 'automation_stalled'
  | 'approval_waiting'
  | 'notification_open'
  | 'question_unanswered';

export type OpenLoop = {
  kind: OpenLoopKind;
  reference_id: string;
  title: string;
  detail: string;
  since_time: Date | null;
};

export type ListOpenLoopsInput = {
  workspace_id: string;
  now?: Date | undefined;
  days?: number | undefined;
  limit?: number | undefined;
};

export async function list_open_loops(
  db: Database,
  input: ListOpenLoopsInput,
): Promise<OpenLoop[]> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - (input.days ?? 7) * 24 * 60 * 60 * 1_000);
  const limit = input.limit ?? 25;
  const groups = await Promise.all([
    list_stalled_automations(db, { workspace_id: input.workspace_id, now, limit }),
    list_open_loops_waiting_on_a_person(db, { workspace_id: input.workspace_id, limit }),
    list_open_notification_loops(db, { workspace_id: input.workspace_id, now, since, limit }),
    list_unanswered_questions(db, { workspace_id: input.workspace_id, since, limit }),
  ]);
  return drop_repeated_loops(groups.flat())
    .sort((left, right) => (right.since_time?.getTime() ?? 0) - (left.since_time?.getTime() ?? 0))
    .slice(0, limit);
}

async function list_stalled_automations(
  db: Database,
  input: { workspace_id: string; now: Date; limit: number },
): Promise<OpenLoop[]> {
  const [overdue, last_runs] = await Promise.all([
    db
      .select({
        automation_id: automations.automation_id,
        automation_name: automations.automation_name,
        next_run_time: triggers.next_run_time,
      })
      .from(automations)
      .innerJoin(triggers, eq(triggers.automation_id, automations.automation_id))
      .where(
        and(
          eq(automations.workspace_id, input.workspace_id),
          eq(automations.automation_status, 'enabled'),
          eq(triggers.trigger_status, 'enabled'),
          lt(triggers.next_run_time, input.now),
        ),
      )
      .limit(input.limit),
    db
      .selectDistinctOn([runs.automation_id], {
        automation_id: runs.automation_id,
        automation_name: automations.automation_name,
        run_id: runs.run_id,
        run_status: runs.run_status,
        created_time: runs.created_time,
      })
      .from(runs)
      .innerJoin(automations, eq(automations.automation_id, runs.automation_id))
      .where(
        and(
          eq(runs.workspace_id, input.workspace_id),
          isNotNull(runs.automation_id),
          eq(automations.automation_status, 'enabled'),
        ),
      )
      .orderBy(runs.automation_id, desc(runs.created_time)),
  ]);

  const failed = last_runs.filter((row) => row.run_status === 'failed');
  const failed_ids = new Set(failed.map((row) => row.automation_id));
  return [
    ...failed.map((row) => ({
      kind: 'automation_stalled' as const,
      reference_id: row.automation_id ?? row.run_id,
      title: `The automation "${row.automation_name}" last run failed`,
      detail: `Run ${row.run_id} ended in ${row.run_status}.`,
      since_time: row.created_time,
    })),
    ...overdue
      .filter((row) => !failed_ids.has(row.automation_id))
      .map((row) => ({
        kind: 'automation_stalled' as const,
        reference_id: row.automation_id,
        title: `The automation "${row.automation_name}" is past due`,
        detail: `It was meant to start at ${row.next_run_time?.toISOString() ?? 'an earlier time'}.`,
        since_time: row.next_run_time,
      })),
  ];
}

function drop_repeated_loops(loops: OpenLoop[]): OpenLoop[] {
  const seen = new Set<string>();
  return loops.filter((loop) => {
    const key = `${loop.kind}:${loop.reference_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function list_open_notification_loops(
  db: Database,
  input: { workspace_id: string; now: Date; since: Date; limit: number },
): Promise<OpenLoop[]> {
  const open = await list_open_notifications(db, {
    workspace_id: input.workspace_id,
    outcomes: ['notify_now', 'add_to_daily_summary'],
    since: input.since,
    limit: input.limit,
  });
  return open
    .filter(({ notification }) => {
      if (notification.proposed_action.kind === 'none') return false;
      return notification.expires_time === null || new Date(notification.expires_time) > input.now;
    })
    .map((row) => ({
      kind: 'notification_open' as const,
      reference_id: row.event_id,
      title: row.notification.title,
      detail: `Proposed ${row.notification.proposed_action.kind}, still open.`,
      since_time: row.created_time,
    }));
}

// "ends with a question mark" is the whole test. A model call to tell a real question
// from a rhetorical one is the upgrade path, the day the scout is seen nagging about one.
async function list_unanswered_questions(
  db: Database,
  input: { workspace_id: string; since: Date; limit: number },
): Promise<OpenLoop[]> {
  const last_messages = await db
    .selectDistinctOn([run_messages.session_id], {
      session_id: run_messages.session_id,
      message_role: run_messages.message_role,
      content_text: run_messages.content_text,
      created_time: run_messages.created_time,
    })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, input.workspace_id),
        eq(run_messages.is_user_visible, true),
        gte(run_messages.created_time, input.since),
      ),
    )
    .orderBy(run_messages.session_id, desc(run_messages.message_sequence));

  return last_messages
    .filter(
      (message) =>
        message.message_role === 'assistant' && Boolean(message.content_text?.trim().endsWith('?')),
    )
    .slice(0, input.limit)
    .map((message) => ({
      kind: 'question_unanswered' as const,
      reference_id: message.session_id,
      title: 'We asked a question nobody answered',
      detail: (message.content_text ?? '').trim().slice(0, 300),
      since_time: message.created_time,
    }));
}
