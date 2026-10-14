import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { create_client_message_id } from '@/components/app/chat_optimistic_messages';
import type { NotSentChatMessage } from '@/components/app/queued_chat_message_text';
import {
  remove_queued_session_message,
  type SessionMessagePayload,
  send_queued_session_message,
} from '@/lib/api';

/** Sends a not-sent queued message again, then removes the failed copy from the queue. */
export function useRetryNotSentMessage(
  session_id: string | undefined,
  refresh: () => Promise<void>,
) {
  const [sent_job_ids, set_sent_job_ids] = useState<ReadonlySet<string>>(new Set());
  const retry = useMutation({
    mutationFn: async (message: NotSentChatMessage) => {
      if (!session_id || !message.retry_message) return;
      await send_queued_session_message(session_id, {
        ...(message.retry_message as SessionMessagePayload),
        client_message_id: create_client_message_id(),
      });
      set_sent_job_ids((current) => new Set(current).add(message.job_id));
      await remove_queued_session_message(session_id, message.job_id);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'The message could not be sent.'),
    onSettled: refresh,
  });
  return {
    run: (message: NotSentChatMessage) => retry.mutate(message),
    retrying_job_id: retry.isPending ? retry.variables?.job_id : undefined,
    sent_job_ids,
  };
}
