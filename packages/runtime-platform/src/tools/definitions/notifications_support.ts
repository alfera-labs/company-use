import type { Notification } from '@coworker/core/db/queries/notification_outcomes';
import type { RuntimeToolResult } from '@coworker/shared';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { z } from 'zod';

const notification_context_schema = z
  .object({
    db: z.custom<RuntimeToolExecutionContext['db']>(
      (value) => value !== undefined && value !== null,
    ),
    workspace_id: z.string().min(1),
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    actor_id: z.string().min(1),
  })
  .passthrough();

export function read_notification_context(
  context: RuntimeToolExecutionContext | undefined,
  node_key: string,
) {
  const parsed = context ? notification_context_schema.safeParse(context) : null;
  if (!parsed?.success) {
    return tool_error('agent_context_unavailable', `${node_key} requires an agent context.`);
  }
  return { success: true as const, data: parsed.data };
}

export function summarize_notification(row: Notification) {
  const { notification } = row;
  return {
    notification_event_id: row.event_id,
    title: notification.title,
    body: notification.body,
    urgency: notification.urgency,
    score: notification.score,
    outcome: row.outcome,
    outcome_reason: notification.outcome_reason,
    held: notification.held,
    delivered_on: notification.delivered_on,
    proposed_action: notification.proposed_action,
    automation_id: notification.automation_id,
    created_time: row.created_time.toISOString(),
  };
}

export function read_zod_message(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

export function tool_error(code: string, message: string): RuntimeToolResult & { success: false } {
  return { success: false, error: { code, message } };
}
