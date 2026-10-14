import type {
  ComposioRecipe,
  ComposioRecipeDimension,
  ComposioRecipeObject,
} from '@connectors/composio/composio_recipe_types';
import type {
  ConnectorSyncDimension,
  ConnectorSyncDownloadContent,
  ConnectorSyncObject,
  ConnectorSyncReadBatch,
} from '@connectors/sync_types';

export type ComposioResolvedSyncDefinition = {
  dimensions: readonly ConnectorSyncDimension[];
  objects: Record<string, ConnectorSyncObject>;
};

function resolve_composio_content(
  object_key: string,
  object: ComposioRecipeObject,
): ConnectorSyncObject['content'] {
  if (object.read_item) {
    const { node_key, input, text } = object.read_item;
    return { read_node: node_key, input, text };
  }
  if (object.content !== undefined) return object.content;
  if (object.read_items_batch) return null;
  throw new Error(
    `composio recipe object ${object_key} has no content, read_item, or read_items_batch.`,
  );
}

function resolve_composio_read_batch(object: ComposioRecipeObject): ConnectorSyncReadBatch | null {
  if (!object.read_items_batch) return null;
  const { node_key, ...batch } = object.read_items_batch;
  return { read_node: node_key, ...batch };
}

function resolve_composio_download_content(
  object: ComposioRecipeObject,
): ConnectorSyncDownloadContent | null {
  if (!object.download_item) return null;
  const { node_key, ...download } = object.download_item;
  return { download_node: node_key, ...download };
}

function resolve_composio_dimension(dimension: ComposioRecipeDimension): ConnectorSyncDimension {
  const { list_scope_options, list_children: _children, search: _search, ...rest } = dimension;
  return {
    ...rest,
    ...(list_scope_options ? { browse_node: list_scope_options.node_key } : {}),
    ...(list_scope_options?.input ? { browse_input: list_scope_options.input } : {}),
  };
}

function resolve_composio_object(
  object_key: string,
  object: ComposioRecipeObject,
): ConnectorSyncObject {
  const {
    list_items,
    read_item: _read_item,
    read_items_batch: _batch,
    download_item: _download,
    content: _content,
    ...rest
  } = object;
  const read_batch = resolve_composio_read_batch(object);
  const download_content = resolve_composio_download_content(object);
  return {
    ...rest,
    ...(read_batch ? { read_batch } : {}),
    ...(download_content ? { download_content } : {}),
    list_node: list_items.node_key,
    content: resolve_composio_content(object_key, object),
    ...(list_items.input ? { list_input: list_items.input } : {}),
  };
}

export function resolve_composio_sync_definition(
  recipe: ComposioRecipe,
): ComposioResolvedSyncDefinition {
  return {
    dimensions: recipe.dimensions.map(resolve_composio_dimension),
    objects: Object.fromEntries(
      Object.entries(recipe.objects).map(([object_key, object]) => [
        object_key,
        resolve_composio_object(object_key, object),
      ]),
    ),
  };
}
