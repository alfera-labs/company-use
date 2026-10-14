import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { type ConnectedAppTimes, connected_app_times } from '@/components/app/chat_connection_dock';
import { has_newly_connected_app, resumed_run_watch_ms } from '@/components/app/chat_session_state';
import { list_connections } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { subscribe_to_connection_setup_returns } from '@/lib/connection_setup_return';

/** Reads the connected apps, and watches for the resumed run when the person connects a new one. */
export function useConnectedChatApps(
  set_resumed_run_watch_deadline_ms: (deadline_ms: number) => void,
) {
  const query_client = useQueryClient();
  const connections_query = useQuery({
    queryFn: list_connections,
    queryKey: query_keys.connections(),
  });
  const connected_apps = useMemo(
    () => (connections_query.data ? connected_app_times(connections_query.data) : undefined),
    [connections_query.data],
  );
  useEffect(
    () =>
      subscribe_to_connection_setup_returns(() => {
        void query_client.invalidateQueries({ queryKey: query_keys.connections() });
      }),
    [query_client],
  );
  const connected_apps_before_ref = useRef<ConnectedAppTimes | undefined>(undefined);
  useEffect(() => {
    if (!connected_apps) return;
    const connected_apps_before = connected_apps_before_ref.current;
    connected_apps_before_ref.current = connected_apps;
    if (!has_newly_connected_app(connected_apps_before, connected_apps)) return;
    set_resumed_run_watch_deadline_ms(Date.now() + resumed_run_watch_ms);
  }, [connected_apps, set_resumed_run_watch_deadline_ms]);
  return connected_apps;
}
