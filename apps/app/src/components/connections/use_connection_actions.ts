// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { format_error_message } from '@coworker/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { patch_connection } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function use_connection_actions(connection: Connection) {
  const query_client = useQueryClient();
  const refresh_connection = async () => {
    await Promise.all([
      query_client.invalidateQueries({ queryKey: query_keys.connections() }),
      query_client.invalidateQueries({ queryKey: query_keys.connection(connection.connection_id) }),
      query_client.invalidateQueries({
        queryKey: query_keys.sharing('connection', connection.connection_id),
      }),
    ]);
  };
  const rename = useMutation({
    mutationFn: (name: string) =>
      patch_connection(connection.connection_id, { connection_name: name.trim() }),
    onSuccess: async () => {
      await refresh_connection();
      toast.success('Connection renamed');
    },
    onError: show_connection_change_error,
  });
  return {
    is_saving: rename.isPending,
    is_renaming: rename.isPending,
    rename: (name: string) => rename.mutate(name),
  };
}

function show_connection_change_error(error: unknown) {
  toast.error(format_error_message(error, 'The change could not be saved.'));
}
