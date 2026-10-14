import type { Connection } from '@/lib/api/types';

const statuses_of_a_connected_account = new Set(['active', 'built_in']);

/** A setup that is pending, failed or expired is not a connected account. */
export function count_connected_accounts(connections: readonly Connection[]) {
  return connections.filter((connection) =>
    statuses_of_a_connected_account.has(connection.connection_status),
  ).length;
}
