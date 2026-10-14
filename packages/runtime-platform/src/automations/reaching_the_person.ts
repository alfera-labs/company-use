import type { Database } from '@coworker/core';
import { get_user } from '@coworker/core/db/queries/users';
import { format_person_name } from '@coworker/shared';
import { read_notification_rules_file } from '@runtime-platform/notifications/notification_rules_file';

export type ReachingThePerson = {
  name: string;
  email: string | null;
  delivery_channel_order: readonly string[];
};

export async function read_reaching_the_person(
  db: Database,
  input: { workspace_id: string; agent_id: string; created_by: string },
): Promise<ReachingThePerson | null> {
  const user = input.created_by.startsWith('user_') ? await get_user(db, input.created_by) : null;
  if (!user) return null;
  const { policy } = await read_notification_rules_file(db, input);
  return {
    name: format_person_name(user.first_name, user.last_name, user.email),
    email: user.email,
    delivery_channel_order: policy.delivery_channel_order,
  };
}

export function reaching_the_person_rail(person: ReachingThePerson | null): string[] {
  if (!person) return [];
  const address = person.email ? ` (${person.email})` : '';
  return [
    `You work for ${person.name}${address}. They read: ${person.delivery_channel_order.join(', ')}. To tell them anything, write a notification with notifications-write_notification-1; the platform delivers it on those channels by their rules. Never build your own way to notify them. When the instruction says to DM, message, email, or ping the person without naming how, that IS the notification: write it with notifications-write_notification-1 and you are done. When the instruction names the tool or the address to reach them, for example an email sent with email-send-1 to a given address, send exactly that; a notification does not replace it. Otherwise do not call a Slack, email or chat send tool to reach them, and never ask them to approve being told something.`,
  ];
}
