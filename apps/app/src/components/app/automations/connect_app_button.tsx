// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { create_connection } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import {
  build_connection_setup_return_url,
  type ConnectionSetupReturnEvent,
  subscribe_to_connection_setup_returns,
} from '@/lib/connection_setup_return';

export type EditorPageActions = {
  retry_trigger_setup?: (() => Promise<unknown>) | undefined;
};

export function ConnectAppButton({
  app,
  onConnected,
}: {
  app: { app_id: string; app_display_name: string };
  onConnected?: (() => Promise<unknown>) | undefined;
}) {
  const { start, busy } = use_connect_app(app, onConnected);
  return (
    <Button
      disabled={busy}
      size="sm"
      type="button"
      variant="outline"
      onClick={() => start.mutate()}
    >
      {busy ? `Connecting ${app.app_display_name}…` : `Connect ${app.app_display_name}`}
    </Button>
  );
}

function use_connect_app(
  app: { app_id: string; app_display_name: string },
  onConnected: (() => Promise<unknown>) | undefined,
) {
  const query_client = useQueryClient();
  const [waiting_for_popup, set_waiting_for_popup] = useState(false);
  const start = useMutation({
    mutationFn: () =>
      create_connection({
        app_id: app.app_id,
        redirect_uri: build_connection_setup_return_url(window.location.origin),
      }),
    onSuccess: (result) => {
      if (!result.start_url) {
        toast.error(`${app.app_display_name} gave nothing to open.`);
        return;
      }
      window.open(result.start_url, '_blank', 'noopener,noreferrer');
      set_waiting_for_popup(true);
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not start connecting.')),
  });

  async function take_return(event: ConnectionSetupReturnEvent) {
    if (event.status === 'error') {
      toast.error(event.error_message ?? `${app.app_display_name} did not connect.`);
      return;
    }
    await query_client.invalidateQueries({ queryKey: query_keys.automation_trigger_types() });
    await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    toast.success(`${app.app_display_name} connected`);
    await onConnected?.();
  }

  useEffect(() => {
    if (!waiting_for_popup) return;
    return subscribe_to_connection_setup_returns((event) => {
      set_waiting_for_popup(false);
      void take_return(event);
    });
  });
  return { start, busy: start.isPending || waiting_for_popup };
}
