import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { confirmed_client_message_ids } from '@/components/app/chat_optimistic_messages';
import {
  is_queued_message_starting,
  type QueuedChatMessage,
} from '@/components/app/chat_queued_messages';
import { with_typed_text } from '@/components/app/queued_chat_message_text';
import { useRetryNotSentMessage } from '@/components/app/use_retry_not_sent_message';
import {
  list_queued_session_messages,
  type QueuedSessionMessage,
  type RunMessage,
  remove_queued_session_message,
  resume_queued_session_messages,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export const queued_messages_poll_ms = 1500;
const queued_messages_socket_poll_ms = 10_000;

type QueuedChatMessagesInput = {
  session_id: string | undefined;
  is_live_socket_open: boolean;
  unconfirmed_messages: RunMessage[];
  forget_own_copy: (client_message_id: string) => void;
};

function useQueuedMessagesQuery(input: QueuedChatMessagesInput) {
  const { session_id, is_live_socket_open, unconfirmed_messages } = input;
  return useQuery({
    enabled: Boolean(session_id),
    queryKey: query_keys.queued_messages(session_id),
    queryFn: () => list_queued_session_messages(session_id ?? ''),
    refetchInterval: (query) => {
      const has_waiting =
        unconfirmed_messages.length > 0 ||
        (query.state.data ?? []).some((message) => message.state !== 'not_sent');
      if (!has_waiting) return false;
      return is_live_socket_open ? queued_messages_socket_poll_ms : queued_messages_poll_ms;
    },
  });
}

function useForgetNotSentOwnCopies(
  queued: QueuedSessionMessage[] | undefined,
  input: QueuedChatMessagesInput,
) {
  const { unconfirmed_messages, forget_own_copy } = input;
  const not_sent_client_message_ids = useMemo(
    () =>
      (queued ?? []).flatMap((message) =>
        message.state === 'not_sent' && message.client_message_id
          ? [message.client_message_id]
          : [],
      ),
    [queued],
  );
  useEffect(() => {
    for (const client_message_id of not_sent_client_message_ids) {
      if (unconfirmed_messages.some((message) => message.run_message_id === client_message_id)) {
        forget_own_copy(client_message_id);
      }
    }
  }, [forget_own_copy, not_sent_client_message_ids, unconfirmed_messages]);
}

function useQueuedMessageActions(
  queued: QueuedSessionMessage[] | undefined,
  input: QueuedChatMessagesInput,
) {
  const { session_id, forget_own_copy } = input;
  const query_client = useQueryClient();
  const refresh = () =>
    query_client.invalidateQueries({ queryKey: query_keys.queued_messages(session_id) });
  const remove = useMutation({
    mutationFn: (job_id: string) => remove_queued_session_message(session_id ?? '', job_id),
    onSuccess: (_removed, job_id) => {
      const client_message_id = queued?.find(
        (message) => message.job_id === job_id,
      )?.client_message_id;
      if (client_message_id) forget_own_copy(client_message_id);
    },
    onError: (error) =>
      toast.message(error instanceof Error ? error.message : 'That message already started.'),
    onSettled: refresh,
  });
  const send_now = useMutation({
    mutationFn: () => resume_queued_session_messages(session_id ?? ''),
    onSettled: refresh,
  });
  return { refresh, remove, send_now, retry: useRetryNotSentMessage(session_id, refresh) };
}

/** Reads the queued messages of a chat and gives the actions on them: remove, retry, send now. */
export function useQueuedChatMessages(input: QueuedChatMessagesInput) {
  const { unconfirmed_messages } = input;
  const queued_query = useQueuedMessagesQuery(input);
  const { refresh, remove, send_now, retry } = useQueuedMessageActions(queued_query.data, input);
  useForgetNotSentOwnCopies(queued_query.data, input);
  const waiting_messages = useMemo(
    () =>
      with_typed_text(queued_query.data ?? [], unconfirmed_messages).filter(
        (message) => !retry.sent_job_ids.has(message.job_id),
      ),
    [queued_query.data, unconfirmed_messages, retry.sent_job_ids],
  );
  const queued_messages = useMemo(
    () => queued_messages_the_transcript_does_not_draw(waiting_messages, unconfirmed_messages),
    [waiting_messages, unconfirmed_messages],
  );
  const queued_client_message_ids = useMemo(
    () => client_message_ids_drawn_as_own_bubbles(queued_messages),
    [queued_messages],
  );
  return {
    queued_messages,
    queued_client_message_ids,
    has_waiting_messages:
      waiting_messages.some((message) => message.state !== 'not_sent') ||
      unconfirmed_messages.length > 0,
    has_message_waiting_to_start:
      waiting_messages.some((message) => message.state === 'queued') ||
      own_copies_on_their_way_to_a_run(waiting_messages, unconfirmed_messages).length > 0,
    refresh,
    remove: (job_id: string) => remove.mutate(job_id),
    retry: retry.run,
    retrying_job_id: retry.retrying_job_id,
    send_now: () => send_now.mutate(),
    is_sending_now: send_now.isPending,
  };
}

/**
 * The own copies whose message still goes to a run by itself. A paused message waits for the
 * person and a message that was not sent waits for a retry: nothing works on either, so neither
 * may keep "Working" and the stop button on the screen.
 */
export function own_copies_on_their_way_to_a_run(
  queued: QueuedChatMessage[],
  unconfirmed_messages: readonly RunMessage[],
) {
  const held_client_message_ids = new Set(
    queued.flatMap((message) =>
      message.state !== 'queued' && message.client_message_id ? [message.client_message_id] : [],
    ),
  );
  return unconfirmed_messages.filter(
    (message) => !held_client_message_ids.has(message.run_message_id),
  );
}

/**
 * Drops the queued messages that the transcript already draws. One kind starts now and was sent
 * from this tab: the transcript has its own copy, in its place, with the day and the sender, so
 * the message never moves when the run starts. The other kind runs a stored message again: that
 * message is in the chat, and a second bubble would show the person's words twice.
 */
export function queued_messages_the_transcript_does_not_draw(
  queued: QueuedChatMessage[],
  unconfirmed_messages: readonly RunMessage[],
) {
  const own_copy_ids = new Set(unconfirmed_messages.map((message) => message.run_message_id));
  return queued.filter((message) => {
    if (message.repeats_run_message_id && message.state !== 'not_sent') return false;
    const has_own_copy = Boolean(
      message.client_message_id && own_copy_ids.has(message.client_message_id),
    );
    return !(is_queued_message_starting(message) && has_own_copy);
  });
}

/** Lists the client message ids that a queued bubble draws, so the transcript hides its copy. */
export function client_message_ids_drawn_as_own_bubbles(messages: QueuedChatMessage[]) {
  return new Set(
    messages.flatMap((message) =>
      message.client_message_id && !('run_id' in message && message.run_id)
        ? [message.client_message_id]
        : [],
    ),
  );
}

/** Keeps only the queued messages that the transcript does not show yet. */
export function queued_messages_not_in_transcript(
  queued: QueuedChatMessage[],
  transcript: readonly RunMessage[],
) {
  const drawn_client_ids = confirmed_client_message_ids(transcript);
  const drawn_run_ids = new Set(transcript.map((message) => message.run_id));
  return queued.filter(
    (message) =>
      !(message.client_message_id && drawn_client_ids.has(message.client_message_id)) &&
      !('run_id' in message && message.run_id && drawn_run_ids.has(message.run_id)),
  );
}
