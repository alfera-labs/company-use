import type { Database } from '@coworker/core';
import { tool_calls } from '@coworker/core/db/schema';
import type { TriggerFireDelivery } from '@runtime-platform/events/trigger_ingress';
import { read_dot_path } from '@runtime-platform/triggers/trigger_rules';
import { and, eq, sql } from 'drizzle-orm';

// Did the agent send this mail itself? An approved send goes out through the person's own mailbox,
// so Gmail puts the same SENT label on it as on their own reply. The difference is the message id:
// the agent's send tool call in this session got that id back from the provider.

const message_id_fields = ['message_id', 'messageId', 'id'];

export async function fire_was_the_agents_own_send(
  db: Database,
  input: { workspace_id: string; session_id: string; delivery?: TriggerFireDelivery | undefined },
): Promise<boolean> {
  const message_id = read_message_id(input.delivery);
  if (!message_id) return false;
  const [sent] = await db
    .select({ tool_call_id: tool_calls.tool_call_id })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.session_id, input.session_id),
        eq(tool_calls.tool_status, 'completed'),
        eq(tool_calls.risk_class, 'send'),
        sql`strpos(coalesce(${tool_calls.output_data}::text, '') || coalesce(${tool_calls.output_text}, ''), ${message_id}) > 0`,
      ),
    )
    .limit(1);
  return Boolean(sent);
}

function read_message_id(delivery?: TriggerFireDelivery): string | null {
  const data = delivery?.data ?? {};
  for (const field of message_id_fields) {
    const value = read_dot_path(data, field);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
