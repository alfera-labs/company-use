import {
  notification_held_schema,
  notification_outcomes,
  notification_proposed_action_schema,
  notification_urgencies,
} from '@coworker/core/db/schema/automation_contracts';
import type { JsonSchema } from '@coworker/shared';
import { z } from 'zod';

export const write_notification_input_schema = z.strictObject({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'What this notification is about: a mail thread id, an invoice number, a flight, a person. The same subject twice is the same notification, and the second one is refused instead of telling them twice.',
    ),
  claim: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'What you are saying about that subject, in a few words: "asked availability", "delayed two hours". Subject plus claim is the identity of this notification — another run that learns the same thing writes the same two and the person is told once.',
    ),
  title: z.string().trim().min(1).max(200).describe('One line, what happened. No emoji.'),
  body: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .describe('A few sentences of what you found, in plain words.'),
  urgency: z
    .enum(notification_urgencies)
    .describe(
      'deadline = there is a time it stops being useful. expires_soon = it may disappear. routine = ordinary progress. fyi = news. system_problem is for the platform reporting on itself.',
    ),
  score: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'How much this deserves the person stopping what they are doing, 0 to 100. Be honest: 90+ means wake them, 20 means it only belongs in a list they may never read.',
    ),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('One sentence for why you gave that score. This is shown to the person.'),
  evidence: z
    .strictObject({
      event_ids: z.array(z.string().min(1)).max(20).default([]),
      brain_slugs: z.array(z.string().min(1)).max(20).default([]),
      run_ids: z.array(z.string().min(1)).max(20).default([]),
      message_refs: z.array(z.string().min(1)).max(20).default([]),
    })
    .describe(
      'What this stands on. At least one reference is required: a notification with no evidence is refused.',
    ),
  expires_time: z
    .string()
    .datetime()
    .optional()
    .describe('ISO time after which this stops mattering. Set it for anything time-bound.'),
  proposed_action: notification_proposed_action_schema
    .optional()
    .describe('The one thing the person can do next. Leave it out when it is only news.'),
  automation_id: z
    .string()
    .min(1)
    .optional()
    .describe('The automation this run belongs to, if any.'),
});

export const write_notification_output_schema = z.strictObject({
  notification_event_id: z.string().nullable(),
  notification_fingerprint: z.string(),
  outcome: z.enum(notification_outcomes),
  outcome_reason: z.string(),
  delivered_on: z.string().nullable(),
  delivery_ref: z.string().nullable(),
  delivery_error: z.string().nullable(),
});

export const list_notifications_input_schema = z.strictObject({
  outcome: z
    .enum(notification_outcomes)
    .optional()
    .describe('Only notifications that ended in this outcome.'),
  search_text: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Words to look for in the title, the body or the evidence. Includes discards.'),
  days: z.coerce.number().int().min(1).max(90).default(7).describe('How far back to look.'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const notification_summary_schema = z.strictObject({
  notification_event_id: z.string(),
  title: z.string(),
  body: z.string(),
  urgency: z.string(),
  score: z.number(),
  outcome: z.string(),
  outcome_reason: z.string(),
  held: notification_held_schema,
  delivered_on: z.string().nullable(),
  proposed_action: notification_proposed_action_schema,
  automation_id: z.string().nullable(),
  created_time: z.string(),
});

export const list_notifications_output_schema = z.strictObject({
  count: z.number(),
  notifications: z.array(notification_summary_schema),
});

export function input_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
}

export function output_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as JsonSchema;
}
