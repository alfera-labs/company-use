import type {
  ComposioRecipe,
  ComposioRecipeDimension,
  ComposioRecipeObject,
} from '@connectors/composio/composio_recipe_types';

export type RecipeNodeRole =
  | 'list_scope_options'
  | 'list_children'
  | 'search'
  | 'list_items'
  | 'read_item'
  | 'read_items_batch'
  | 'list_folders';

export type RecipeNodeReference = {
  toolkit_slug: string;
  owner_key: string;
  role: RecipeNodeRole;
  node_key: string;
  sent_fields: readonly string[];
};

function field_root(input_path: string): string {
  return input_path.replace(/\[\]$/u, '').split('.')[0] ?? input_path;
}

function list_dimension_references(
  toolkit_slug: string,
  dimension: ComposioRecipeDimension,
): RecipeNodeReference[] {
  const base = { toolkit_slug, owner_key: dimension.key };
  const references: RecipeNodeReference[] = [];
  if (dimension.list_scope_options) {
    const { node_key, input } = dimension.list_scope_options;
    references.push({
      ...base,
      role: 'list_scope_options',
      node_key,
      sent_fields: Object.keys(input ?? {}),
    });
  }
  if (dimension.list_children) {
    const { node_key, input, parent_id_param } = dimension.list_children;
    const sent_fields = [...Object.keys(input ?? {}), field_root(parent_id_param)];
    references.push({ ...base, role: 'list_children', node_key, sent_fields });
  }
  if (dimension.search) {
    const { node_key, input, query_param } = dimension.search;
    const sent_fields = [...Object.keys(input ?? {}), field_root(query_param)];
    references.push({ ...base, role: 'search', node_key, sent_fields });
  }
  return references;
}

function list_object_references(
  toolkit_slug: string,
  object_key: string,
  object: ComposioRecipeObject,
): RecipeNodeReference[] {
  const base = { toolkit_slug, owner_key: object_key };
  const list_fields = [
    ...Object.keys(object.list_items.input ?? {}),
    ...Object.values(object.scoped_by)
      .filter((scope_path): scope_path is string => scope_path !== null)
      .map(field_root),
    ...(object.page.cursor_param ? [field_root(object.page.cursor_param)] : []),
    ...(object.page.page_size_param ? [field_root(object.page.page_size_param)] : []),
    ...(object.cursor ? [field_root(object.cursor.param)] : []),
  ];
  const references: RecipeNodeReference[] = [
    {
      ...base,
      role: 'list_items',
      node_key: object.list_items.node_key,
      sent_fields: [...new Set(list_fields)],
    },
  ];
  if (object.read_item) {
    const { node_key, input } = object.read_item;
    references.push({ ...base, role: 'read_item', node_key, sent_fields: Object.keys(input) });
  }
  if (object.read_items_batch) {
    const { node_key, input, ids_param } = object.read_items_batch;
    const sent_fields = [...Object.keys(input ?? {}), field_root(ids_param)];
    references.push({ ...base, role: 'read_items_batch', node_key, sent_fields });
  }
  const folders = object.path?.parent_chain?.folders;
  if (folders) {
    const sent_fields = [
      ...Object.keys(folders.input ?? {}),
      ...(folders.page.cursor_param ? [field_root(folders.page.cursor_param)] : []),
    ];
    references.push({ ...base, role: 'list_folders', node_key: folders.node_key, sent_fields });
  }
  return references;
}

export function list_recipe_node_references(recipe: ComposioRecipe): RecipeNodeReference[] {
  return [
    ...recipe.dimensions.flatMap((dimension) =>
      list_dimension_references(recipe.toolkit_slug, dimension),
    ),
    ...Object.entries(recipe.objects).flatMap(([object_key, object]) =>
      list_object_references(recipe.toolkit_slug, object_key, object),
    ),
  ];
}
