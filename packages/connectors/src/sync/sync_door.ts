import { get_connector_app, read_connector_app_hold } from '@connectors/registry';
import { execute_node } from '@connectors/runtime/execute_node';
import type {
  FetchConnectorFileDependencies,
  FetchConnectorFileResult,
} from '@connectors/runtime/fetch_connector_file';
import { fetch_connector_file } from '@connectors/runtime/fetch_connector_file';
import type { ScopeSelectionRow } from '@connectors/sync/list_scope_selection';
import { list_scope_selection } from '@connectors/sync/list_scope_selection';
import type {
  ConnectorSyncDimension,
  ConnectorSyncDirectory,
  ConnectorSyncFile,
  ConnectorSyncObject,
} from '@connectors/sync_types';
import type { ConnectorConnection, ConnectorResult } from '@connectors/types';

export type SyncNodeResult<T = unknown> = ConnectorResult<T>;

export type SyncDoor = {
  run_node: (node_key: string, input: unknown) => Promise<SyncNodeResult>;
  list_scope_options: (dimension: ConnectorSyncDimension) => Promise<readonly ScopeSelectionRow[]>;
  fetch_file: (file: ConnectorSyncFile) => Promise<FetchConnectorFileResult>;
};

export type ResolvedSyncDefinition = {
  app_key: string;
  dimensions: readonly ConnectorSyncDimension[];
  objects: Record<string, ConnectorSyncObject>;
  directory?: ConnectorSyncDirectory;
};

export type CreateSyncDoorResult =
  | { outcome: 'ok'; door: SyncDoor }
  | { outcome: 'app_held'; reason: string };

const default_file_fetch_limits = {
  max_bytes: 25 * 1024 * 1024,
  max_redirects: 5,
  timeout_ms: 30_000,
};

function build_file_fetch_dependencies(app_key: string): FetchConnectorFileDependencies {
  const app = get_connector_app(app_key);
  return {
    policy: {
      allowed_hosts: app?.sync?.file_fetch?.hosts ?? [],
      base_url_host: app ? new URL(app.base_url).host : '',
    },
    limits: default_file_fetch_limits,
    send_request: (url, init) => fetch(url, init),
  };
}

function build_fetch_file(app_key: string, connection: ConnectorConnection) {
  const dependencies = build_file_fetch_dependencies(app_key);
  return (file: ConnectorSyncFile): Promise<FetchConnectorFileResult> => {
    if (!file.download_url) return Promise.resolve({ outcome: 'host_refused' as const });
    return fetch_connector_file(dependencies, {
      url: file.download_url,
      headers: { Authorization: `Bearer ${connection.access_token}` },
    });
  };
}

export function create_native_sync_door(
  connection: ConnectorConnection,
  app_key: string,
): CreateSyncDoorResult {
  const hold = read_connector_app_hold(app_key);
  if (hold) return { outcome: 'app_held', reason: hold.reason };
  return {
    outcome: 'ok',
    door: {
      run_node: (node_key, input) => execute_node(node_key, input, connection),
      list_scope_options: (dimension) => list_scope_selection(connection, dimension),
      fetch_file: build_fetch_file(app_key, connection),
    },
  };
}
