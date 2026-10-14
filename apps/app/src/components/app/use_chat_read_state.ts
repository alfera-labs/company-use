import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { mark_session_read, type Session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function useMarkChatRead(session: Session | undefined) {
  const query_client = useQueryClient();
  const session_id = session?.session_id;
  const newest_sequence = session?.newest_sequence;
  const is_unread = session?.is_unread;

  const mark_read = useMutation({
    mutationFn: mark_session_read,
    onSuccess: () => query_client.invalidateQueries({ queryKey: query_keys.sessions() }),
    onError: (error) => console.error('Could not mark this chat as read.', error),
  });

  // Only `mutate` is a dependency: the mutation object is rebuilt every render, and depending
  // on it would re-fire an effect whose success invalidates the query that feeds it.
  const mark_read_now = mark_read.mutate;

  useEffect(() => {
    if (!session_id || !newest_sequence) return;
    if (!is_unread) return;
    mark_read_now({ session_id, last_read_sequence: newest_sequence });
  }, [session_id, newest_sequence, is_unread, mark_read_now]);
}
