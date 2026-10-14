import type { Database } from '@coworker/core/db/connection';
import { events } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

const notification_source = 'notification';
const notification_actor = 'system:notifications';

export type NotificationStepRef = {
  workspace_id: string;
  campaign_id: string;
  episode: string;
  step: number;
};

function send_dedup_key(ref: NotificationStepRef) {
  return `notification:${ref.campaign_id}:${ref.episode}:${ref.step}`;
}

function step_row(ref: NotificationStepRef) {
  return and(
    eq(events.workspace_id, ref.workspace_id),
    eq(events.source, notification_source),
    eq(events.source_event_id, send_dedup_key(ref)),
  );
}

function campaign_episode_rows(input: {
  workspace_id: string;
  campaign_id: string;
  episode: string;
}) {
  return and(
    eq(events.workspace_id, input.workspace_id),
    eq(events.source, notification_source),
    eq(events.event_type, `${input.campaign_id}.sent`),
    sql`${events.event_body}->>'episode' = ${input.episode}`,
  );
}

export async function claim_notification_step(
  db: Database,
  ref: NotificationStepRef,
): Promise<boolean> {
  const [row] = await db
    .insert(events)
    .values({
      event_id: create_id(id_prefixes.event),
      workspace_id: ref.workspace_id,
      source: notification_source,
      source_event_id: send_dedup_key(ref),
      event_type: `${ref.campaign_id}.sent`,
      queue_key: `workspace:${ref.workspace_id}`,
      actor_key: notification_actor,
      event_body: {
        campaign_id: ref.campaign_id,
        episode: ref.episode,
        step: ref.step,
        channels_delivered: [],
      },
      created_by: notification_actor,
      last_updated_by: notification_actor,
    })
    .onConflictDoNothing({ target: [events.workspace_id, events.source, events.source_event_id] })
    .returning({ event_id: events.event_id });
  return Boolean(row);
}

export async function record_notification_channels(
  db: Database,
  ref: NotificationStepRef & { channels_delivered: string[] },
): Promise<void> {
  await db
    .update(events)
    .set({
      event_body: {
        campaign_id: ref.campaign_id,
        episode: ref.episode,
        step: ref.step,
        channels_delivered: ref.channels_delivered,
      },
      last_updated_time: new Date(),
      last_updated_by: notification_actor,
    })
    .where(step_row(ref));
}

export async function release_notification_step(
  db: Database,
  ref: NotificationStepRef,
): Promise<void> {
  await db.delete(events).where(step_row(ref));
}

export async function count_notification_sends(
  db: Database,
  input: { workspace_id: string; campaign_id: string; episode: string },
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .where(campaign_episode_rows(input));
  return row?.total ?? 0;
}

export async function last_notification_send_time(
  db: Database,
  input: { workspace_id: string; campaign_id: string; episode: string },
): Promise<Date | null> {
  const [row] = await db
    .select({ last_sent: sql<string | null>`max(${events.created_time})` })
    .from(events)
    .where(campaign_episode_rows(input));
  return row?.last_sent ? new Date(row.last_sent) : null;
}
