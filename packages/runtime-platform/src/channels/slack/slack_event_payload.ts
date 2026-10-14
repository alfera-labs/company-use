import { z } from 'zod';

const slack_authorization_schema = z
  .object({ team_id: z.string().min(1).optional() })
  .passthrough();

const slack_nested_message_schema = z
  .object({
    user: z.string().min(1).optional(),
    text: z.string().optional(),
    files: z.unknown().optional(),
  })
  .passthrough();

const slack_message_event_schema = z
  .object({
    type: z.string().min(1).optional(),
    subtype: z.string().min(1).optional(),
    team: z.string().min(1).optional(),
    channel: z.string().min(1).optional(),
    channel_type: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    ts: z.string().min(1).optional(),
    event_ts: z.string().min(1).optional(),
    thread_ts: z.string().min(1).optional(),
    text: z.string().optional(),
    bot_id: z.string().min(1).optional(),
    files: z.unknown().optional(),
    message: slack_nested_message_schema.optional(),
  })
  .passthrough();

export const slack_event_body_schema = z
  .object({
    type: z.string().min(1),
    challenge: z.string().optional(),
    event_id: z.string().optional(),
    team_id: z.string().min(1).optional(),
    api_app_id: z.string().min(1).optional(),
    event: slack_message_event_schema.optional(),
    authorizations: z.array(slack_authorization_schema).optional(),
  })
  .passthrough();

export type SlackEventBody = z.infer<typeof slack_event_body_schema>;
export type SlackMessageEvent = z.infer<typeof slack_message_event_schema>;
