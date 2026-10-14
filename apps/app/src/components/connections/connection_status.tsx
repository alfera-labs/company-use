import { Badge } from '@coworker/ui/components/badge';
import type { Connection } from '@/lib/api/types';

type ConnectionStatusSource = Pick<Connection, 'connection_status' | 'cannot_work_now'>;

/**
 * The one word for the state of a connection. A connection that is stored as active and cannot
 * work now reads as what stops it ("Switched off", "Not working"), never as "Active".
 */
export function read_connection_status_label(connection: ConnectionStatusSource): string {
  return connection.cannot_work_now?.status_label ?? format_status(connection.connection_status);
}

export function ConnectionStatusBadge({ connection }: { connection: ConnectionStatusSource }) {
  return (
    <Badge variant={read_badge_variant(connection)}>
      {read_connection_status_label(connection)}
    </Badge>
  );
}

/**
 * One sentence under a connection that cannot work now: why, and what to do. Nothing otherwise.
 * With no class of its own it sits under the words of a row in the list of connections.
 */
export function ConnectionCannotWorkNote({
  connection,
  className = 'pr-2 pb-2 pl-16 text-muted-foreground text-sm',
}: {
  connection: ConnectionStatusSource;
  className?: string;
}) {
  if (!connection.cannot_work_now) return null;
  return <p className={className}>{connection.cannot_work_now.sentence}</p>;
}

/**
 * The line under the name of a connection in the list: what stops it, else the account it is
 * connected to, else what the app is, else its state.
 */
export function read_connection_detail(
  connection: ConnectionStatusSource &
    Pick<Connection, 'external_account_name' | 'external_account_id'>,
  what_the_app_is: string | null | undefined,
): string {
  return (
    connection.cannot_work_now?.status_label ??
    connection.external_account_name ??
    connection.external_account_id ??
    what_the_app_is ??
    format_status(connection.connection_status)
  );
}

/** What a person reads after Reconnect on a server that has no sign-in to renew. */
export function words_for_tools_read_again(server_name: string, tool_count: number): string {
  const tools = tool_count === 1 ? '1 tool' : `${tool_count} tools`;
  return `${server_name} answers, and Alfera read its tools again: ${tools}.`;
}

function read_badge_variant(connection: ConnectionStatusSource) {
  if (connection.cannot_work_now) return 'caution';
  const status = connection.connection_status;
  if (status === 'active' || status === 'built_in') return 'positive';
  return status === 'revoked' ? 'destructive' : 'caution';
}

function format_status(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
