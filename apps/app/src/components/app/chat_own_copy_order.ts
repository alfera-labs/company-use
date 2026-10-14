import type { RunMessage } from '@/lib/api';

/** True for the copy of a message that this tab drew at once, before the API stored the message. */
export function is_own_unconfirmed_copy(message: RunMessage) {
  return message.message_role === 'user' && message.source_metadata?.optimistic === true;
}

/** The run that a stored message of a person started. An own copy has started no run yet. */
export function run_started_by(message: RunMessage) {
  const has_started_a_run =
    message.message_role === 'user' && Boolean(message.run_id) && !is_own_unconfirmed_copy(message);
  return has_started_a_run ? { started_run_id: message.run_id } : {};
}

/**
 * Splits the messages of a chat into the stored ones, by their sequence, and the own copies, in
 * the order the person sent them. An own copy was typed after everything the API has stored. Its
 * sequence is a guess and its time is the clock of this tab, so neither can place it between
 * stored messages: a stored message is dated when its run starts, which can be after a later send.
 */
export function split_stored_messages_and_own_copies(messages: readonly RunMessage[]) {
  const stored_messages = messages
    .filter((message) => !is_own_unconfirmed_copy(message))
    .sort(
      (left, right) =>
        Number(left.message_sequence ?? 0) - Number(right.message_sequence ?? 0) ||
        left.run_message_id.localeCompare(right.run_message_id),
    );
  const own_copies = messages
    .filter(is_own_unconfirmed_copy)
    .sort((left, right) => left.created_time.localeCompare(right.created_time));
  return { stored_messages, own_copies };
}

/** The stored messages first, then the own copies in the order the person sent them. */
export function stored_messages_then_own_copies(messages: readonly RunMessage[]) {
  const { stored_messages, own_copies } = split_stored_messages_and_own_copies(messages);
  return [...stored_messages, ...own_copies];
}
