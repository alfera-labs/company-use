import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const datadog_recipe: ComposioRecipe = {
  toolkit_slug: 'DATADOG',
  prompt: 'Sync Datadog monitors',
  dimensions: [
    {
      key: 'account',
      label: 'Account',
      shape: 'flat',
      implicit_single_account: true,
      allow_select_all: true,
    },
  ],
  objects: {
    monitor: {
      label: 'Monitor',
      list_items: { node_key: 'datadog-list_monitors-1' },
      scoped_by: { account: null },
      page: {
        items: { $: 'response.monitors' },
        cursor_kind: 'page_number',
        cursor_param: 'page',
        first_cursor: 0,
        page_size: 100,
        page_size_param: 'page_size',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.modified' },
      title: { $default: [{ $: 'item.name' }, { $: 'item.id' }] },
      content: {
        name: { $: 'item.name' },
        type: { $: 'item.type' },
        query: { $: 'item.query' },
        message: { $: 'item.message' },
        state: { $: 'item.overall_state' },
        tags: { $: 'item.tags' },
      },
      item_kind: 'monitor',
      metadata: {
        status: { $: 'item.overall_state' },
        type: { $: 'item.type' },
        tags: { $: 'item.tags' },
        modified: { $: 'item.modified' },
      },
      note: 'DATADOG_LIST_MONITORS pages from page 0 with page_size 100 (its cap). It has no modified-since filter, so the walk relists and diffs by id. A deleted monitor leaves the list, and the sweep removes it.',
    },
  },
};
