import type { ConnectorRecordPath } from '@connectors/sync/record_path_types';
import type { ConnectorValueExpression } from '@connectors/types';

type ConnectorSyncShape = 'tree' | 'flat' | 'query';

export type ConnectorSyncDimension = {
  key: string;
  label: string;
  shape: ConnectorSyncShape;
  browse_node?: string | undefined;
  option_mapping?: Record<string, ConnectorValueExpression>;
  browse_input?: Record<string, unknown>;
  browse_request?: Record<string, ConnectorValueExpression>;
  search_param?: string;
  selection_includes_descendants?: true;
  allow_select_all?: boolean;
  select_all_lists_unscoped?: true;
  placeholder?: string;
  prompt?: string;
};

type ConnectorSyncStrategy = 'relist_diff' | 'modified_since' | 'append_log';

export type PageCursorKind = 'token' | 'page_number' | 'offset' | 'last_item';

export type ConnectorSyncPage = {
  items: ConnectorValueExpression;
  next_cursor?: ConnectorValueExpression;
  cursor_param?: string;
  cursor_kind?: PageCursorKind;
  first_cursor?: number;
  page_size?: number;
  page_size_param?: string;
  has_more?: ConnectorValueExpression;
  error?: ConnectorValueExpression;
};

export type ConnectorSyncCursor = {
  field: ConnectorValueExpression;
  param: string;
  overlap_minutes?: number;
  initial_lookback_days?: number;
  max_age_days?: number;
  expired_error_contains?: readonly string[];
  marker_format?: 'epoch_seconds' | 'iso_time' | 'iso_date';
  param_type?: 'string' | 'integer';
  template?: WatermarkTemplate;
};

export type WatermarkTemplateEscape = 'sql_quote' | 'backslash_quote' | 'time_literal';

export type WatermarkTemplate = {
  text: string;
  escape: WatermarkTemplateEscape;
};

type ConnectorSyncReadContent = {
  read_node: string;
  input: Record<string, ConnectorValueExpression>;
  text: ConnectorValueExpression;
};

export type ConnectorSyncReadBatch = {
  read_node: string;
  ids_param: string;
  input?: Record<string, ConnectorValueExpression>;
  items: ConnectorValueExpression;
  identity: ConnectorValueExpression;
  text: ConnectorValueExpression;
  max_batch_size?: number;
};

type ConnectorSyncBucket =
  | { by: 'day'; of: ConnectorValueExpression }
  | { by: 'key'; key: ConnectorValueExpression; scoped?: boolean };

export type ConnectorSyncFile = {
  id: string;
  name: string;
  mime_type: string;
  byte_size?: number | null;
  download_url?: string | null;
};

export type ConnectorSyncTextResolver = {
  pattern: string;
  lookup?: 'person';
  render: string;
};

export type ConnectorSyncLine = {
  author: ConnectorValueExpression;
  time?: ConnectorValueExpression;
  text?: ConnectorValueExpression;
};

export type ConnectorSyncDirectory = {
  list_node: string;
  list_input?: Record<string, unknown>;
  page: {
    items: ConnectorValueExpression;
    next_cursor?: ConnectorValueExpression;
    cursor_param?: string;
  };
  identity: ConnectorValueExpression;
  display_name: ConnectorValueExpression;
  email?: ConnectorValueExpression;
  person_kind?: { bot?: ConnectorValueExpression; guest?: ConnectorValueExpression };
};

export type ConnectorSyncFileFetch = {
  node?: string;
  hosts?: readonly string[];
};

export type ConnectorSyncDownloadContent = {
  download_node: string;
  file_id_param: string;
  export_param?: string;
  file_id: ConnectorValueExpression;
  mime_type: ConnectorValueExpression;
  size_bytes?: ConnectorValueExpression;
  export_formats?: Record<string, string>;
};

export type ConnectorSyncObject = {
  list_node: string;
  scoped_by: Record<string, string | null>;
  list_input?: Record<string, unknown>;
  page: ConnectorSyncPage;
  when?: ConnectorValueExpression;
  strategy: ConnectorSyncStrategy;
  cursor?: ConnectorSyncCursor;
  edit_window_days?: number;
  listing_limit_note?: string;
  identity: ConnectorValueExpression;
  version_signal?: ConnectorValueExpression;
  tombstone?: ConnectorValueExpression;
  title: ConnectorValueExpression;
  content: ConnectorValueExpression | ConnectorSyncReadContent;
  read_batch?: ConnectorSyncReadBatch;
  download_content?: ConnectorSyncDownloadContent;
  item_kind: string;
  metadata?: Record<string, ConnectorValueExpression>;
  container?: { id: ConnectorValueExpression; path?: ConnectorValueExpression };
  path?: ConnectorRecordPath;
  source_url?: ConnectorValueExpression;
  relationships?: Record<string, ConnectorValueExpression>;
  text_resolvers?: readonly ConnectorSyncTextResolver[];
  line?: ConnectorSyncLine;
  files?: ConnectorValueExpression;
  file_fetch_input?: Record<string, ConnectorValueExpression>;
  bucket?: ConnectorSyncBucket;
  label?: string;
  note?: string;
};

export type ConnectorSync = {
  prompt?: string;
  dimensions: readonly ConnectorSyncDimension[];
  objects?: Record<string, ConnectorSyncObject>;
  directory?: ConnectorSyncDirectory;
  file_fetch?: ConnectorSyncFileFetch;
};
