// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { words_for_tools_read_again } from '@/components/connections/connection_status';
import { reconnect_connection } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { ConnectionSetupResult } from '@/lib/api/types';
import { build_connection_setup_return_url } from '@/lib/connection_setup_return';

/**
 * Reconnect for one connection, for the list and for the page of a connection. A server with
 * no sign-in to renew answers with its tools read again: the person reads that at once, and no
 * setup starts. Every other connection hands its setup to `on_setup_started`. Whatever the
 * answer, what the screen says of the connection is read again, because a Reconnect that fails
 * changes it too.
 */
export function use_reconnect_connection(input: {
  on_setup_started: (result: ConnectionSetupResult) => void;
  on_error: (error: unknown) => void;
  on_busy_connection?: (connection_id: string | null) => void;
}) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (connection_id: string) =>
      reconnect_connection(connection_id, {
        redirect_uri: build_connection_setup_return_url(window.location.origin),
      }),
    onMutate: (connection_id) => input.on_busy_connection?.(connection_id),
    onSuccess: (result) => {
      if (!result.tools_read_again) return input.on_setup_started(result);
      const server_name = result.connection.connection_name ?? 'The server';
      toast.success(words_for_tools_read_again(server_name, result.tools_read_again.tool_count));
    },
    onError: input.on_error,
    onSettled: async (_result, _error, connection_id) => {
      input.on_busy_connection?.(null);
      await Promise.all([
        query_client.invalidateQueries({ queryKey: query_keys.connections() }),
        query_client.invalidateQueries({ queryKey: query_keys.connection(connection_id) }),
      ]);
    },
  });
}
