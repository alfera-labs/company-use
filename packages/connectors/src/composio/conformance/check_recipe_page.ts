import type { ComposioRecipeObject } from '@connectors/composio/composio_recipe_types';
import type {
  ConformanceProblem,
  ProblemOwner,
} from '@connectors/composio/conformance/conformance_types';
import {
  element_shape,
  type Shape,
  type ShapeScope,
  unchecked_shape,
} from '@connectors/composio/conformance/expression_shape';
import { check_expression } from '@connectors/composio/conformance/node_shapes';

type ComposioRecipePage = ComposioRecipeObject['page'];

function check_pagination(owner: ProblemOwner, page: ComposioRecipePage): ConformanceProblem[] {
  const kind = page.cursor_kind;
  if (kind === 'page_number' || kind === 'offset') return [];
  const has_param = Boolean(page.cursor_param);
  const has_next = page.next_cursor !== undefined;
  if (has_param === has_next) return [];
  const field = has_param ? 'page.next_cursor' : 'page.cursor_param';
  const actual = has_param
    ? `cursor_param ${page.cursor_param} without next_cursor`
    : 'next_cursor without cursor_param';
  return [
    { ...owner, field, expected: 'cursor_param and next_cursor as a pair', actual, level: 'error' },
  ];
}

export function check_page(owner: ProblemOwner, page: ComposioRecipePage, response: Shape) {
  const scope: ShapeScope = { response };
  const items = check_expression(owner, 'page.items', page.items, scope);
  const item = items.shape.kind === 'missing' ? null : element_shape(items.shape);
  const cursor_scope: ShapeScope =
    page.cursor_kind === 'last_item' ? { ...scope, item: item ?? unchecked_shape } : scope;
  const problems = [
    ...items.problems,
    ...check_expression(owner, 'page.next_cursor', page.next_cursor, cursor_scope).problems,
    ...check_expression(owner, 'page.error', page.error, scope).problems,
    ...check_expression(owner, 'page.has_more', page.has_more, scope).problems,
    ...check_pagination(owner, page),
  ];
  if (!item && items.shape.kind !== 'missing') {
    problems.push({
      ...owner,
      field: 'page.items',
      expected: 'an array',
      actual: 'not an array',
      level: 'error',
    });
  }
  return { item: item ?? unchecked_shape, problems };
}
