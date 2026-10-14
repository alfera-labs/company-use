import { format_error_message } from '@coworker/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { use_reconnect_connection } from '@/components/connections/use_reconnect_connection';
import { revoke_connection } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function ConnectionDetailActions({ connection }: { connection: Connection }) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const reconnect = use_reconnect_connection({
    on_setup_started: (result) => {
      if (result.start_url) window.open(result.start_url, '_blank', 'noopener,noreferrer');
      else toast.error(result.setup.setup_error ?? 'The setup link is missing.');
    },
    on_error: show_action_error,
  });
  const disconnect = useMutation({
    mutationFn: () => revoke_connection(connection.connection_id),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
      toast.success('Connection disconnected');
      navigate({ to: '/integrations' });
    },
    onError: show_action_error,
  });

  return (
    <div className="flex flex-wrap gap-2">
      {connection.permissions.can_manage && connection.connection_status !== 'built_in' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reconnect.isPending || connection.connection_status === 'pending_setup'}
          onClick={() => reconnect.mutate(connection.connection_id)}
        >
          {reconnect.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Reconnect
        </Button>
      ) : null}
      {connection.permissions.can_delete ? (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" size="sm" variant="outline" disabled={disconnect.isPending}>
                {disconnect.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                Disconnect
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
              <AlertDialogDescription>
                Its tools stop working until you reconnect the account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <AlertDialogAction type="button" onClick={() => disconnect.mutate()}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function show_action_error(error: unknown) {
  toast.error(format_error_message(error, 'The connection action failed.'));
}
