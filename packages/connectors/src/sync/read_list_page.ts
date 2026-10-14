import { is_counted_cursor, next_counted_cursor } from '@connectors/sync/page_cursor';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import { evaluate_value_expression } from '@connectors/value_expression';

export type PagedListing = Pick<ConnectorSyncObject, 'page'>;

export type ListPage = {
  items: unknown[];
  next_cursor: string | null;
  error_code: string | null;
};

function read_has_more(recipe: PagedListing, scope: { response: unknown }): unknown {
  return recipe.page.has_more ? evaluate_value_expression(recipe.page.has_more, scope) : true;
}

function read_last_item_cursor(
  recipe: PagedListing,
  scope: { response: unknown },
  items: unknown[],
): unknown {
  const page = recipe.page;
  const last_item = items.at(-1);
  if (last_item === undefined || !page.next_cursor) return null;
  if (page.page_size !== undefined && items.length < page.page_size) return null;
  if (!read_has_more(recipe, scope)) return null;
  return evaluate_value_expression(page.next_cursor, { ...scope, item: last_item });
}

function read_next_cursor(
  recipe: PagedListing,
  produced: unknown,
  page: { items: unknown[]; page_cursor: string | null },
): unknown {
  const scope = { response: produced };
  if (recipe.page.cursor_kind === 'last_item') {
    return read_last_item_cursor(recipe, scope, page.items);
  }
  if (is_counted_cursor(recipe.page)) {
    return next_counted_cursor(recipe.page, {
      page_cursor: page.page_cursor,
      item_count: page.items.length,
      has_more: read_has_more(recipe, scope),
    });
  }
  return recipe.page.next_cursor ? evaluate_value_expression(recipe.page.next_cursor, scope) : null;
}

function read_cursor_text(next_cursor: unknown): string | null {
  if (typeof next_cursor === 'number' && Number.isFinite(next_cursor)) return String(next_cursor);
  return typeof next_cursor === 'string' && next_cursor.length > 0 ? next_cursor : null;
}

export function read_list_page(
  recipe: PagedListing,
  produced: unknown,
  page_cursor: string | null = null,
): ListPage {
  const listed = evaluate_value_expression(recipe.page.items, { response: produced });
  if (listed !== undefined && listed !== null && !Array.isArray(listed)) {
    throw new Error('A sync object`s page.items must read an array out of the list node`s output.');
  }
  const items = (listed as unknown[] | null | undefined) ?? [];
  const next_cursor = read_next_cursor(recipe, produced, { items, page_cursor });
  const error_code = recipe.page.error
    ? evaluate_value_expression(recipe.page.error, { response: produced })
    : null;
  return {
    items,
    next_cursor: read_cursor_text(next_cursor),
    error_code: typeof error_code === 'string' && error_code.length > 0 ? error_code : null,
  };
}
