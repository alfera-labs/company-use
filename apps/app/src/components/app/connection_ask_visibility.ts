import type { Connection } from '@/lib/api';

export type ConnectionAskVisibility = 'hide' | 'recheck' | 'show';

export function connection_ask_visibility(input: {
  connection_id: string | null;
  connections: Connection[] | undefined;
  has_rechecked: boolean;
  is_connected: boolean;
  list_postdates_ask: boolean;
}): ConnectionAskVisibility {
  if (input.is_connected) return 'show';
  if (!input.connection_id) return 'show';
  if (!input.connections) return 'hide';
  if (has_connection_row(input.connections, input.connection_id)) return 'show';
  if (input.list_postdates_ask) return 'hide';
  return input.has_rechecked ? 'hide' : 'recheck';
}

export function has_connection_row(connections: Connection[], connection_id: string) {
  return connections.some((connection) => connection.connection_id === connection_id);
}
