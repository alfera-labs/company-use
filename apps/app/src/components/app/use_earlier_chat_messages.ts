import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { merge_message_pages } from '@/components/app/chat_timeline';
import { list_session_messages, type RunMessage } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/** Keeps, per chat, the cursor of the next older page of messages. */
export function useEarlierMessagesCursor(session_id: string | undefined) {
  const [cursor_by_session, set_cursor_by_session] = useState<Record<string, number | null>>({});
  const earlier_messages_cursor = session_id ? (cursor_by_session[session_id] ?? null) : null;
  const set_earlier_messages_cursor = useCallback(
    (cursor: number | null) => {
      if (!session_id) return;
      set_cursor_by_session((current) => ({ ...current, [session_id]: cursor }));
    },
    [session_id],
  );
  return { earlier_messages_cursor, set_earlier_messages_cursor };
}

/** Loads the next older page of messages when the person scrolls to the top. */
export function useLoadEarlierMessages(input: {
  session_id: string | undefined;
  earlier_messages_cursor: number | null;
  set_earlier_messages_cursor: (cursor: number | null) => void;
}) {
  const { session_id, earlier_messages_cursor } = input;
  const query_client = useQueryClient();
  const load_earlier_messages = useMutation({
    mutationFn: async () => {
      if (!session_id || earlier_messages_cursor === null) return;
      const page = await list_session_messages(session_id, {
        before_sequence: earlier_messages_cursor,
      });
      query_client.setQueryData<RunMessage[]>(query_keys.messages(session_id), (existing) =>
        merge_message_pages(existing, page.items),
      );
      input.set_earlier_messages_cursor(page.next_cursor);
    },
  });
  const load_earlier_messages_on_scroll = useCallback(
    () => load_earlier_messages.mutate(),
    [load_earlier_messages.mutate],
  );
  return { is_loading: load_earlier_messages.isPending, load_earlier_messages_on_scroll };
}
