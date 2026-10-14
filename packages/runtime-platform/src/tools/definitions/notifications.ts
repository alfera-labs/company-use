import {
  list_notifications_page,
  search_notifications,
} from '@coworker/core/db/queries/notification_outcomes';
import { AppError } from '@coworker/shared';
import { write_notification } from '@runtime-platform/notifications/write_notification';
import {
  input_json_schema,
  list_notifications_input_schema,
  list_notifications_output_schema,
  output_json_schema,
  write_notification_input_schema,
  write_notification_output_schema,
} from '@runtime-platform/tools/definitions/notifications_schemas';
import {
  read_notification_context,
  read_zod_message,
  summarize_notification,
  tool_error,
} from '@runtime-platform/tools/definitions/notifications_support';
import { keep_notifications_person_reads } from '@runtime-platform/tools/notification_readers';
import { read_automation_id } from '@runtime-platform/tools/source_metadata';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const notifications_app_name = 'notifications';

export const write_notification_tool: RuntimeToolDefinition<
  typeof write_notification_input_schema
> = {
  node_key: 'notifications-write_notification-1',
  node_name: 'write_notification',
  display_name: 'Write notification',
  description:
    'Records something a human should know, with the evidence behind it and your own score for how much it deserves their attention. Use it for anything you learned that the person did not ask for in this turn. The workspace notification rules decide whether it interrupts them now, waits for the daily summary, or is only kept on the record — you never send the message yourself. At least one piece of evidence is required. The title and body are read by the person on their phone: say what happened and what, if anything, they should do; never include ids, session references, scores, or the name of the automation unless it is the subject.',
  category: 'attention',
  source_context_policy: { mode: 'current_turn' },
  input_schema: input_json_schema(write_notification_input_schema),
  output_schema: output_json_schema(write_notification_output_schema),
  app_name: notifications_app_name,
  required_connection: false,
  runtime_handler: 'notifications.write_notification',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: write_notification_input_schema,
  async execute(input, context) {
    const parsed_context = read_notification_context(context, 'notifications-write_notification-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    try {
      const result = await write_notification(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        actor_id: ctx.actor_id,
        written_by: 'run',
        notification: {
          automation_id: input.automation_id ?? read_automation_id(context?.source_context) ?? null,
          run_id: ctx.run_id,
          session_id: ctx.session_id,
          subject: input.subject,
          claim: input.claim,
          title: input.title,
          body: input.body,
          urgency: input.urgency,
          expires_time: input.expires_time ?? null,
          evidence: input.evidence,
          ...(input.proposed_action ? { proposed_action: input.proposed_action } : {}),
          score: input.score,
          reason: input.reason,
        },
      });
      return {
        success: true,
        data: write_notification_output_schema.parse({
          notification_event_id: result.notification_event_id,
          notification_fingerprint: result.notification_fingerprint,
          outcome: result.outcome,
          outcome_reason: result.outcome_reason,
          delivered_on: result.delivered_on,
          delivery_ref: result.delivery_ref,
          delivery_error: result.delivery_error,
        }),
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return tool_error('notification_invalid', read_zod_message(error));
      }
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const list_notifications_tool: RuntimeToolDefinition<
  typeof list_notifications_input_schema
> = {
  node_key: 'notifications-list_notifications-1',
  node_name: 'list_notifications',
  display_name: 'List notifications',
  description:
    'Reads notifications this workspace already has, newest first — including the ones that were dropped, which is how you answer "did you see anything about X?" and "why did you not tell me?". Filter by outcome, or search the words.',
  category: 'attention',
  input_schema: input_json_schema(list_notifications_input_schema),
  output_schema: output_json_schema(list_notifications_output_schema),
  app_name: notifications_app_name,
  required_connection: false,
  runtime_handler: 'notifications.list_notifications',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_notifications_input_schema,
  async execute(input, context) {
    const parsed_context = read_notification_context(context, 'notifications-list_notifications-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const every_row = input.search_text
      ? await search_notifications(ctx.db, {
          workspace_id: ctx.workspace_id,
          search_text: input.search_text,
          days: input.days,
          limit: input.limit,
        })
      : (
          await list_notifications_page(ctx.db, {
            workspace_id: ctx.workspace_id,
            ...(input.outcome ? { outcomes: [input.outcome] } : {}),
            days: input.days,
            page: 1,
            page_size: input.limit,
          })
        ).items;
    const rows = await keep_notifications_person_reads(
      ctx.db,
      { workspace_id: ctx.workspace_id, user_id: ctx.actor_id },
      every_row,
    );
    const notifications = rows
      .filter((row) => !input.outcome || row.outcome === input.outcome)
      .map(summarize_notification);

    return {
      success: true,
      data: list_notifications_output_schema.parse({ count: notifications.length, notifications }),
    };
  },
};

export const notification_tools = [
  write_notification_tool,
  list_notifications_tool,
] satisfies RuntimeToolDefinition[];
