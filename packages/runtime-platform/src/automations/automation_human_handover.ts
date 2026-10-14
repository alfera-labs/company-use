import type { Database } from '@coworker/core';
import { events } from '@coworker/core/db/schema';
import {
  type AutomationFire,
  automation_fire_schema,
} from '@runtime-platform/automations/automation_fire';
import { fire_was_written_by_the_person } from '@runtime-platform/automations/automation_fire_sender';
import { fire_was_the_agents_own_send } from '@runtime-platform/automations/automation_own_send';
import { queue_key_is_about_subject } from '@runtime-platform/automations/automation_subject';
import {
  mark_automation_subject_customer_wrote_again,
  mark_automation_subject_human_took_over,
  read_automation_subject_state,
} from '@runtime-platform/automations/automation_subject_state';
import { and, eq, gte } from 'drizzle-orm';

export async function read_human_handover(
  db: Database,
  workspace_id: string,
  session: { session_id: string; session_metadata: Record<string, unknown> },
  subject_value: string | null,
  fire: AutomationFire,
  batch: readonly AutomationFire[] = [],
): Promise<{ stage: string; reason: string } | null> {
  const state = read_automation_subject_state(session);
  const this_mail_is_theirs = await some_fire_was_theirs(db, workspace_id, session.session_id, [
    fire,
    ...batch,
  ]);
  if (state.human_took_over_time) {
    if (!this_mail_is_theirs) {
      await mark_automation_subject_customer_wrote_again(db, {
        workspace_id,
        session_id: session.session_id,
      });
    }
    return {
      stage: 'human',
      reason: `A person took this subject over at ${state.human_took_over_time}.`,
    };
  }
  const theirs =
    this_mail_is_theirs ||
    (await a_recent_fire_on_this_thread_was_theirs(
      db,
      workspace_id,
      session.session_id,
      subject_value,
    ));
  if (!theirs) return null;
  await mark_automation_subject_human_took_over(db, {
    workspace_id,
    session_id: session.session_id,
  });
  return {
    stage: 'human',
    reason: 'The person wrote on this thread themselves, so they have it.',
  };
}

const recent_fire_window_ms = 10 * 60 * 1000;

async function a_recent_fire_on_this_thread_was_theirs(
  db: Database,
  workspace_id: string,
  session_id: string,
  subject_value: string | null,
): Promise<boolean> {
  if (!subject_value) return false;
  const rows = await db
    .select({ event_body: events.event_body })
    .from(events)
    .where(
      and(
        eq(events.workspace_id, workspace_id),
        eq(events.source, 'trigger'),
        queue_key_is_about_subject(events.queue_key, subject_value),
        gte(events.created_time, new Date(Date.now() - recent_fire_window_ms)),
      ),
    );
  const fires = rows.flatMap((row) => {
    const parsed = automation_fire_schema.safeParse(row.event_body);
    return parsed.success ? [parsed.data] : [];
  });
  return some_fire_was_theirs(db, workspace_id, session_id, fires);
}

async function some_fire_was_theirs(
  db: Database,
  workspace_id: string,
  session_id: string,
  fires: readonly Pick<AutomationFire, 'delivery'>[],
): Promise<boolean> {
  for (const fire of fires) {
    if (!fire_was_written_by_the_person(fire.delivery)) continue;
    const own_send = await fire_was_the_agents_own_send(db, {
      workspace_id,
      session_id,
      delivery: fire.delivery,
    });
    if (!own_send) return true;
  }
  return false;
}
