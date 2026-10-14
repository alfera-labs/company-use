import { createHash } from 'node:crypto';
import type { NotificationProposedAction } from '@coworker/core/db/schema/automation_contracts';
import {
  notification_evidence_schema,
  notification_proposed_action_schema,
  notification_urgencies,
} from '@coworker/core/db/schema/automation_contracts';
import { z } from 'zod';

const writer_evidence_schema = z
  .strictObject({
    event_ids: z.array(z.string().min(1)).default([]),
    brain_slugs: z.array(z.string().min(1)).default([]),
    run_ids: z.array(z.string().min(1)).default([]),
    message_refs: z.array(z.string().min(1)).default([]),
  })
  .pipe(notification_evidence_schema);

export const notification_schema = z.strictObject({
  automation_id: z.string().min(1).nullable().default(null),
  run_id: z.string().min(1),
  session_id: z.string().min(1).nullable().default(null),
  principal_id: z.string().min(1).nullable().default(null),
  subject: z.string().trim().min(1).max(200),
  claim: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4_000),
  urgency: z.enum(notification_urgencies),
  expires_time: z.string().datetime().nullable().default(null),
  evidence: writer_evidence_schema,
  proposed_action: notification_proposed_action_schema.default({ kind: 'none' }),
  score: z.coerce.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(500),
});

export type Notification = z.output<typeof notification_schema>;

export function notification_fingerprint(
  workspace_id: string,
  notification: { subject: string; claim: string },
) {
  const subject = normalized(notification.subject);
  const claim = normalized(notification.claim);
  return createHash('sha256').update(`${workspace_id}:${subject}:${claim}`).digest('hex');
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}
export type NotificationInput = z.input<typeof notification_schema>;

export function notification_because_line(notification: Notification) {
  const references = [
    ...notification.evidence.event_ids,
    ...notification.evidence.brain_slugs,
    ...notification.evidence.run_ids,
    ...notification.evidence.message_refs,
  ].slice(0, 3);
  return references.length > 0
    ? `${notification.reason} (${references.join(', ')})`
    : notification.reason;
}

const next_step_words_by_kind: {
  [Kind in NotificationProposedAction['kind']]: (
    action: Extract<NotificationProposedAction, { kind: Kind }>,
  ) => string;
} = {
  none: () => 'Nothing is needed from you.',
  open_draft: () => 'Open the draft in Alfera and send it when it reads right.',
  approve_held_call: () => 'Approve the held step in your inbox and it continues.',
  create_automation: (action) => `Say yes and this becomes an automation: ${action.instruction}`,
  offer_to_act: (action) =>
    `Say yes and I will ${action.instruction}.` +
    (action.needs_apps.length > 0 ? ` (I need ${action.needs_apps.join(' and ')} for this.)` : ''),
  connect_app: (action) => `Connect ${action.app_name} and I will ${action.reason}.`,
  improve_automation: () => 'Say yes and I will change it.',
  retire_automation: () => 'Say yes and I will retire it.',
};

export function notification_next_step(action: NotificationProposedAction) {
  const words = next_step_words_by_kind[action.kind] as (
    value: NotificationProposedAction,
  ) => string;
  return words(action);
}
