import type { Database, DatabaseExecutor } from '@coworker/core';
import {
  empty_participants,
  may_use_resource,
  type Participants,
} from '@coworker/core/access/may_use_resource';
import { resource_type_definitions } from '@coworker/core/access/resource_types';
import { list_redacted_connections } from '@coworker/core/db/queries/connection_management';
import {
  list_grants_for_resources,
  type ResourceGrantRow,
  read_grant_rules,
} from '@coworker/core/db/queries/resource_grants';
import { list_connections } from '@coworker/core/db/queries/sessions';
import { built_in_connection_status } from '@coworker/core/integrations/alfera_api_tools';

export type ConnectionSnapshotItem = {
  connection_id: string;
  app_name: string;
  app_display_name: string;
  app_category: string;
  connection_name: string;
  connection_status: string;
  health_status: string;
  provider_key: string;
  external_account_name: string;
  connected_time: string;
  authenticated_hosts: string[];
  api_protocol_headers: Record<string, string>;
  accessible: boolean;
};

type RedactedConnection = Awaited<ReturnType<typeof list_redacted_connections>>[number];

export async function list_connection_snapshot(
  db: Database,
  input: {
    workspace_id: string;
    participants?: Participants;
    room_private_to?: string | null | undefined;
  },
): Promise<ConnectionSnapshotItem[]> {
  const connections = (await list_redacted_connections(db, input.workspace_id)).filter(
    (connection) => connection.connection_status !== built_in_connection_status,
  );
  const grants_by_connection = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_ids: connections.map((connection) => connection.connection_id),
  });

  return connections
    .map((connection) =>
      create_connection_snapshot_item(
        connection,
        grants_by_connection.get(connection.connection_id) ?? [],
        input,
      ),
    )
    .sort(compare_connection_snapshot_items);
}

export async function list_usable_connections(
  db: Database,
  input: { workspace_id: string } & SnapshotGathering,
) {
  const rows = await list_connections_with_access(db, input);
  return rows.filter((row) => row.usable).map((row) => row.connection);
}

export async function list_connections_with_access(
  db: DatabaseExecutor,
  input: { workspace_id: string } & SnapshotGathering,
) {
  const rows = await list_connections(db, input.workspace_id);
  const grants_by_connection = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_ids: rows.map((connection) => connection.connection_id),
  });
  return rows.map((connection) => ({
    connection,
    usable: participant_grants_allow(
      grants_by_connection.get(connection.connection_id) ?? [],
      input,
      connection.connected_by,
    ),
  }));
}

type SnapshotGathering = {
  participants?: Participants;
  room_private_to?: string | null | undefined;
};

function create_connection_snapshot_item(
  connection: RedactedConnection,
  grants: readonly ResourceGrantRow[],
  gathering: SnapshotGathering,
): ConnectionSnapshotItem {
  const accessible = participant_grants_allow(grants, gathering, connection.connected_by);
  return {
    connection_id: connection.connection_id,
    app_name: connection.app?.app_name ?? '',
    app_display_name: connection.app?.app_display_name ?? '',
    app_category: connection.app?.app_category ?? '',
    connection_name: connection.connection_name ?? '',
    connection_status: connection.connection_status,
    health_status: connection.health_status ?? '',
    provider_key: connection.provider_key ?? '',
    external_account_name: accessible ? (connection.external_account_name ?? '') : '',
    connected_time: connection.connected_time?.toISOString() ?? '',
    authenticated_hosts: accessible ? read_authenticated_hosts(connection.app) : [],
    api_protocol_headers: accessible ? read_api_protocol_headers(connection.app) : {},
    accessible,
  };
}

function participant_grants_allow(
  grants: readonly ResourceGrantRow[],
  gathering: SnapshotGathering,
  owner_user_id?: string | null,
) {
  if (grants.length === 0) return true;
  return may_use_resource({
    default_access: resource_type_definitions.connection.default_access,
    grants: read_grant_rules(grants),
    participants: gathering.participants ?? empty_participants,
    owner_user_id,
    room_private_to: gathering.room_private_to,
  }).allowed;
}

function read_authenticated_hosts(app: RedactedConnection['app']): string[] {
  return app?.authenticated_request_hosts ?? [];
}

function read_api_protocol_headers(app: RedactedConnection['app']): Record<string, string> {
  return app?.api_protocol_headers ?? {};
}

const connection_status_ranks: Record<string, number> = {
  active: 1,
  pending_setup: 2,
  failed: 3,
  revoked: 4,
};

function compare_connection_snapshot_items(
  left: ConnectionSnapshotItem,
  right: ConnectionSnapshotItem,
) {
  return (
    connection_status_rank(left) - connection_status_rank(right) ||
    connected_time_milliseconds(right) - connected_time_milliseconds(left) ||
    left.app_display_name.localeCompare(right.app_display_name)
  );
}

function connected_time_milliseconds(connection: ConnectionSnapshotItem) {
  return connection.connected_time ? Date.parse(connection.connected_time) : 0;
}

function connection_status_rank(connection: ConnectionSnapshotItem) {
  return connection_status_ranks[connection.connection_status] ?? 5;
}
