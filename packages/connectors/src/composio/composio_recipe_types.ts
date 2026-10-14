import type { ConnectorRecordPath } from '@connectors/sync/record_path_types';
import type { ConnectorSyncCursor, ConnectorSyncPage } from '@connectors/sync_types';
import type { ConnectorValueExpression } from '@connectors/types';

type ComposioRecipeShape = 'tree' | 'flat' | 'query';

export type RecipeNodeCall = {
  node_key: string;
  input?: Record<string, unknown>;
};

export type ComposioRecipeDimension = {
  key: string;
  label: string;
  shape: ComposioRecipeShape;
  list_scope_options?: RecipeNodeCall;
  list_children?: RecipeNodeCall & { parent_id_param: string };
  search?: RecipeNodeCall & { query_param: string };
  option_items?: ConnectorValueExpression;
  option_mapping?: Record<string, ConnectorValueExpression>;
  option_when?: ConnectorValueExpression;
  implicit_single_account?: true;
  search_param?: string;
  allow_select_all?: boolean;
  select_all_lists_unscoped?: true;
  placeholder?: string;
  prompt?: string;
};

type ComposioRecipeStrategy = 'relist_diff' | 'modified_since' | 'append_log';

type ComposioRecipePage = ConnectorSyncPage;

type ComposioRecipeCursor = ConnectorSyncCursor;

type ComposioRecipeBucket =
  | { by: 'day'; of: ConnectorValueExpression }
  | { by: 'key'; key: ConnectorValueExpression };

export type RecipeReadItem = {
  node_key: string;
  input: Record<string, ConnectorValueExpression>;
  text: ConnectorValueExpression;
};

export type RecipeReadItemsBatch = {
  node_key: string;
  ids_param: string;
  input?: Record<string, ConnectorValueExpression>;
  items: ConnectorValueExpression;
  identity: ConnectorValueExpression;
  text: ConnectorValueExpression;
  max_batch_size?: number;
};

export type RecipeDownloadItem = {
  node_key: string;
  file_id_param: string;
  export_param?: string;
  file_id: ConnectorValueExpression;
  mime_type: ConnectorValueExpression;
  size_bytes?: ConnectorValueExpression;
  export_formats?: Record<string, string>;
};

export type ComposioRecipeObject = {
  list_items: RecipeNodeCall;
  read_item?: RecipeReadItem;
  download_item?: RecipeDownloadItem;
  read_items_batch?: RecipeReadItemsBatch;
  scoped_by: Record<string, string | null>;
  page: ComposioRecipePage;
  when?: ConnectorValueExpression;
  strategy: ComposioRecipeStrategy;
  cursor?: ComposioRecipeCursor;
  edit_window_days?: number;
  listing_limit_note?: string;
  identity: ConnectorValueExpression;
  version_signal?: ConnectorValueExpression;
  tombstone?: ConnectorValueExpression;
  title: ConnectorValueExpression;
  content?: ConnectorValueExpression;
  item_kind: string;
  metadata?: Record<string, ConnectorValueExpression>;
  container?: { id: ConnectorValueExpression; path?: ConnectorValueExpression };
  path?: ConnectorRecordPath;
  source_url?: ConnectorValueExpression;
  relationships?: Record<string, ConnectorValueExpression>;
  files?: ConnectorValueExpression;
  file_fetch_input?: Record<string, ConnectorValueExpression>;
  bucket?: ComposioRecipeBucket;
  label?: string;
  note?: string;
};

export type ComposioRecipe = {
  toolkit_slug: string;
  app_display_name?: string;
  unavailable_reason?: string;
  preferred_provider?: 'native' | 'composio';
  prompt?: string;
  file_fetch?: { node_key: string };
  dimensions: readonly ComposioRecipeDimension[];
  objects: Record<string, ComposioRecipeObject>;
};
