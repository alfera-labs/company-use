import type { Database } from '@coworker/core';
import { tool_policy_approval_wait_schema } from '@coworker/core/access/tool_policy_approval_schema';
import { get_session } from '@coworker/core/db/queries/sessions';
import type { event_jobs } from '@coworker/core/db/schema';
import type { DeliveryChannel } from '@coworker/core/db/schema/automation_contracts';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  default_notification_rules,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { send_email_approval_card } from '@runtime-platform/tools/policies/approval_email_card';
import { send_slack_approval_cards } from '@runtime-platform/tools/policies/approval_slack_cards';

const log = create_logger('approval_delivery');

type EventJob = typeof event_jobs.$inferSelect;

const approval_channels: Record<
  DeliveryChannel,
  (db: Database, input: { workspace_id: string; wait: EventJob }) => Promise<number>
> = {
  chat: async () => 0,
  slack_dm: send_slack_approval_cards,
  email: send_email_approval_card,
  web: async () => 1,
};

export async function send_approval_cards(
  db: Database,
  input: {
    workspace_id: string;
    wait: EventJob;
    policy_readers?: Parameters<typeof read_notification_rules_file>[2];
  },
) {
  const delivery_channel_order = await read_reach_order(db, input);
  for (const channel of delivery_channel_order) {
    const delivered = await approval_channels[channel](db, input).catch((error: unknown) => {
      log.warn('sending the approval card failed for one channel', {
        channel,
        workspace_id: input.workspace_id,
        job_id: input.wait.job_id,
        error: format_error_message(error),
      });
      return 0;
    });
    if (delivered > 0) return delivered;
  }
  return 0;
}

async function read_reach_order(
  db: Database,
  input: Parameters<typeof send_approval_cards>[1],
): Promise<readonly DeliveryChannel[]> {
  const parsed = tool_policy_approval_wait_schema.safeParse(input.wait.metadata.policy_approval);
  const session = parsed.success
    ? await get_session(db, input.workspace_id, parsed.data.session_id)
    : null;
  if (!session) return default_notification_rules.delivery_channel_order;

  const { policy } = await read_notification_rules_file(
    db,
    { workspace_id: input.workspace_id, agent_id: session.agent_id },
    input.policy_readers ?? {},
  );
  return policy.delivery_channel_order;
}
