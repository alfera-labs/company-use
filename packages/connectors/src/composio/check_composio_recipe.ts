import { composio_recipe_schema } from '@connectors/composio/composio_recipe_schema';
import type {
  ComposioRecipe,
  ComposioRecipeDimension,
  ComposioRecipeObject,
} from '@connectors/composio/composio_recipe_types';
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { evaluate_value_expression } from '@connectors/value_expression';
import { format_error_message } from '@coworker/shared';

const empty_expression_scope = { item: {}, scope: {}, response: {} };

function list_object_expressions(object: ComposioRecipeObject): unknown[] {
  return [
    object.page.items,
    object.page.next_cursor,
    object.page.error,
    object.page.has_more,
    object.when,
    object.files,
    object.cursor?.field,
    object.identity,
    object.version_signal,
    object.tombstone,
    object.title,
    object.content,
    object.read_item?.text,
    ...Object.values(object.read_item?.input ?? {}),
    object.read_items_batch?.items,
    object.read_items_batch?.identity,
    object.read_items_batch?.text,
    ...Object.values(object.read_items_batch?.input ?? {}),
    object.container?.id,
    object.container?.path,
    object.source_url,
    ...Object.values(object.metadata ?? {}),
    object.bucket?.by === 'day' ? object.bucket.of : object.bucket?.key,
    ...Object.values(object.relationships ?? {}),
  ].filter((expression) => expression !== undefined);
}

function check_scoped_by(
  object: ComposioRecipeObject,
  dimensions: ReadonlyMap<string, ComposioRecipeDimension>,
  where: string,
) {
  for (const [dimension_key, scope_path] of Object.entries(object.scoped_by)) {
    const dimension = dimensions.get(dimension_key);
    if (!dimension) {
      throw new Error(`${where} is scoped by ${dimension_key}, which is not a declared dimension.`);
    }
    if (scope_path === null && !dimension.implicit_single_account) {
      throw new Error(
        `${where} sends no input for ${dimension_key}, which only an implicit_single_account dimension allows.`,
      );
    }
  }
}

function check_page_cursor(object: ComposioRecipeObject, where: string) {
  const page = object.page;
  const is_numeric = page.cursor_kind === 'page_number' || page.cursor_kind === 'offset';
  if (is_numeric && !page.cursor_param) {
    throw new Error(`${where} uses a ${page.cursor_kind} cursor, which needs page.cursor_param.`);
  }
  if (is_numeric && page.next_cursor !== undefined) {
    throw new Error(
      `${where} uses a ${page.cursor_kind} cursor, which counts instead of reading next_cursor.`,
    );
  }
  const is_last_item = page.cursor_kind === 'last_item';
  if (is_last_item && (!page.cursor_param || page.next_cursor === undefined)) {
    throw new Error(
      `${where} uses a last_item cursor, which needs page.cursor_param and page.next_cursor.`,
    );
  }
  if (!is_numeric && page.first_cursor !== undefined) {
    throw new Error(`${where} sets first_cursor, which only a counted cursor reads.`);
  }
  if (!is_numeric && !is_last_item && page.has_more !== undefined) {
    throw new Error(`${where} sets has_more, which only a counted or last_item cursor reads.`);
  }
  if (page.cursor_kind === 'offset' && page.page_size === undefined) {
    throw new Error(`${where} uses an offset cursor, which needs page.page_size.`);
  }
  if (page.page_size_param && page.page_size === undefined) {
    throw new Error(`${where} sets page.page_size_param without page.page_size.`);
  }
  if (object.cursor?.param_type === 'integer' && object.cursor.marker_format !== 'epoch_seconds') {
    throw new Error(
      `${where} sends an integer watermark, which needs marker_format epoch_seconds.`,
    );
  }
  if (object.cursor?.template && object.cursor.param_type === 'integer') {
    throw new Error(`${where} fills a watermark template, which sends a string, not an integer.`);
  }
}

function check_dimension(dimension: ComposioRecipeDimension, where_recipe: string) {
  check_expressions(
    [dimension.option_items, dimension.option_when],
    `${where_recipe}: dimension ${dimension.key}`,
  );
  if (!dimension.implicit_single_account) return;
  const browse_calls = [dimension.list_scope_options, dimension.list_children, dimension.search];
  if (browse_calls.some((call) => call !== undefined)) {
    throw new Error(
      `${where_recipe}: dimension ${dimension.key} is implicit_single_account, so it has no browse calls.`,
    );
  }
}

function check_strategy(object: ComposioRecipeObject, where: string) {
  const needs_cursor = object.strategy !== 'relist_diff';
  if (needs_cursor && !object.cursor) {
    throw new Error(`${where} uses ${object.strategy}, which needs a cursor.`);
  }
  if (!needs_cursor && object.cursor) {
    throw new Error(`${where} uses relist_diff, which has no cursor to send.`);
  }
  if (object.edit_window_days !== undefined && object.strategy !== 'append_log') {
    throw new Error(`${where} sets edit_window_days, which only append_log re-reads.`);
  }
}

export function check_composio_recipe(recipe: ComposioRecipe) {
  const where_recipe = `composio recipe ${recipe.toolkit_slug}`;
  const violation = find_json_schema_violation(composio_recipe_schema, recipe, where_recipe);
  if (violation) throw new Error(`${where_recipe} is malformed: ${violation}`);

  for (const dimension of recipe.dimensions) check_dimension(dimension, where_recipe);
  const dimensions = new Map(recipe.dimensions.map((dimension) => [dimension.key, dimension]));
  for (const [object_key, object] of Object.entries(recipe.objects)) {
    const where = `${where_recipe}: object ${object_key}`;
    check_scoped_by(object, dimensions, where);
    check_strategy(object, where);
    check_page_cursor(object, where);
    check_expressions(list_object_expressions(object), where);
  }
}

function check_expressions(expressions: readonly unknown[], where: string) {
  for (const expression of expressions) {
    if (expression === undefined) continue;
    try {
      evaluate_value_expression(expression, empty_expression_scope);
    } catch (error) {
      throw new Error(
        `${where} holds a malformed value expression: ${format_error_message(error)}`,
      );
    }
  }
}
