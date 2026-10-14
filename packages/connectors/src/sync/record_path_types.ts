import type { ConnectorSyncPage } from '@connectors/sync_types';
import type { ConnectorValueExpression } from '@connectors/types';

export type ConnectorPathText = {
  text: ConnectorValueExpression;
  strip_prefix?: string;
  split_on?: string;
};

export type ConnectorPathSegment = ConnectorValueExpression | ConnectorPathText;

export type ConnectorFolderListing = {
  node_key: string;
  input?: Record<string, unknown>;
  page: ConnectorSyncPage;
  id: ConnectorValueExpression;
  name: ConnectorValueExpression;
  parent_id?: ConnectorValueExpression;
  when?: ConnectorValueExpression;
};

export type ConnectorParentChain = {
  parent_ids: ConnectorValueExpression;
  folders: ConnectorFolderListing;
  known_names?: Record<string, string>;
  name_separator?: string;
  root_name?: string;
  no_parent_name?: string;
};

export type ConnectorRecordPath = {
  segments?: readonly ConnectorPathSegment[];
  parent_chain?: ConnectorParentChain;
};

export type FolderEntry = { name: string; parent_id: string | null };

export type FolderMap = ReadonlyMap<string, FolderEntry>;
