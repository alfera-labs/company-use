import { read_api_data, session_queued_messages_client } from '@/lib/api/client';
import type { SentSessionMessage, SessionMessagePayload } from '@/lib/api/types';

type MessageModel = Pick<
  SessionMessagePayload,
  'model_name' | 'model_provider' | 'model_proxy' | 'reasoning_level'
>;

/** Runs a stored message of a chat again. The chat gets a new answer, not a second message. */
export async function repeat_queued_session_message(
  session_id: string,
  input: MessageModel & { run_message_id: string; client_message_id: string },
): Promise<SentSessionMessage> {
  return read_api_data<SentSessionMessage>(
    await session_queued_messages_client.repeat.$post({
      param: { session_id },
      json: input as Parameters<typeof session_queued_messages_client.repeat.$post>[0]['json'],
    }),
    { method: 'POST', path: `/v1/sessions/${session_id}/queued-messages/repeat` },
  );
}
