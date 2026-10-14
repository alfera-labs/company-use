import type { ComposioRecipeObject } from '@connectors/composio/composio_recipe_types';
import { sent_runtime_string } from '@connectors/composio/conformance/check_node_inputs';
import type { SentInput } from '@connectors/composio/conformance/conformance_types';

function sent_integer(path: string, supplies_required: boolean): SentInput {
  return { path, shape: { kind: 'typed', types: ['integer'] }, supplies_required };
}

export function page_inputs(page: ComposioRecipeObject['page']): SentInput[] {
  const counted = page.cursor_kind === 'page_number' || page.cursor_kind === 'offset';
  const cursor_param = page.cursor_param;
  const cursor = cursor_param
    ? [counted ? sent_integer(cursor_param, true) : sent_runtime_string(cursor_param, false)]
    : [];
  const size_param = page.page_size_param;
  const size: SentInput[] = size_param
    ? [
        {
          path: size_param,
          shape: { kind: 'literal', value: page.page_size },
          supplies_required: true,
        },
      ]
    : [];
  return [...cursor, ...size];
}

export function list_items_inputs(
  object: ComposioRecipeObject,
  scope_path: string | null,
): SentInput[] {
  const literals = Object.entries(object.list_items.input ?? {}).map(
    ([path, value]): SentInput => ({
      path,
      shape: { kind: 'literal', value },
      supplies_required: true,
    }),
  );
  const scope = scope_path === null ? [] : [sent_runtime_string(scope_path, true)];
  const cursor = object.cursor;
  const watermark = cursor
    ? [
        cursor.param_type === 'integer'
          ? sent_integer(cursor.param, true)
          : sent_runtime_string(cursor.param, true),
      ]
    : [];
  return [...literals, ...scope, ...page_inputs(object.page), ...watermark];
}
