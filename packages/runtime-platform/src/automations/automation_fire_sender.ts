import type { TriggerFireDelivery } from '@runtime-platform/events/trigger_ingress';
import { read_dot_path } from '@runtime-platform/triggers/trigger_rules';

const sent_label = 'sent';

const sent_label_fields = ['label_ids', 'labelIds', 'payload.label_ids', 'payload.labelIds'];

const verified_member_field = 'sender_is_verified_member';

/**
 * True when the person wrote the mail that fired the automation. Only signals a sender
 * cannot type count: Gmail's SENT label, or a DMARC-verified workspace member. A mail the mailbox
 * sent only to itself (a website form relaying through the owner's address) is not theirs.
 */
export function fire_was_written_by_the_person(delivery?: TriggerFireDelivery): boolean {
  const data = delivery?.data ?? {};
  if (read_dot_path(data, verified_member_field) === true) return true;
  const sent = sent_label_fields.some((field) => read_labels(data, field).includes(sent_label));
  return sent && !mail_to_itself_only(data);
}

/**
 * True when the mail came from the workspace's own managed address: an approval request, a
 * notification, or a mail the agent sent. An automation that ran on it would let the agent react
 * to, and answer, its own messages.
 */
export function fire_was_sent_from_the_workspace_address(
  delivery: TriggerFireDelivery | undefined,
  workspace_address: string | null,
): boolean {
  if (!workspace_address) return false;
  const data = delivery?.data ?? {};
  const [sender] = read_addresses(read_dot_path(data, 'sender') ?? read_dot_path(data, 'from'));
  return sender === workspace_address.toLowerCase();
}

function mail_to_itself_only(data: Record<string, unknown>) {
  const [sender] = read_addresses(read_dot_path(data, 'sender') ?? read_dot_path(data, 'from'));
  const recipients = read_addresses(read_dot_path(data, 'to'));
  return Boolean(sender) && recipients.length > 0 && recipients.every((to) => to === sender);
}

function read_addresses(value: unknown): string[] {
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  return (text.match(/[^\s<>,;"']+@[^\s<>,;"']+/gu) ?? []).map((address) => address.toLowerCase());
}

function read_labels(data: Record<string, unknown>, field: string): string[] {
  const value = read_dot_path(data, field);
  if (!Array.isArray(value)) return [];
  return value
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim().toLowerCase());
}
