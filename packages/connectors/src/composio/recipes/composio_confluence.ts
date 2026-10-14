import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_confluence_recipe: ComposioRecipe = {
  toolkit_slug: 'CONFLUENCE',
  prompt: 'Pick the Confluence space to keep in sync.',
  dimensions: [
    {
      key: 'spaces',
      label: 'Spaces',
      shape: 'flat',
      list_scope_options: { node_key: 'confluence-get_spaces-1' },
      search: { node_key: 'confluence-search_spaces-1', query_param: 'query' },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $: 'item.name' },
      },
      allow_select_all: true,
      prompt: 'Pick the Confluence spaces to sync pages from.',
    },
  ],
  objects: {
    page: {
      list_items: {
        node_key: 'confluence-get_pages-1',
        input: { body_format: 'storage', limit: 100 },
      },
      scoped_by: { spaces: 'space_id' },
      page: {
        items: { $: 'response.results' },
        next_cursor: { $: 'response._links.next' },
        cursor_param: 'cursor',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.version.number' },
      title: { $: 'item.title' },
      content: { $default: [{ $: 'item.body.storage.value' }, { $literal: '' }] },
      item_kind: 'confluence_page',
      container: { id: { $: 'scope.id' } },
      path: {
        segments: [{ $: 'scope.label' }],
        parent_chain: {
          parent_ids: { $: 'item.parentId' },
          folders: {
            node_key: 'confluence-get_pages-1',
            input: { limit: 250 },
            page: {
              items: { $: 'response.results' },
              next_cursor: { $: 'response._links.next' },
              cursor_param: 'cursor',
            },
            id: { $: 'item.id' },
            name: { $default: [{ $: 'item.title' }, { $: 'item.id' }] },
            parent_id: { $: 'item.parentId' },
          },
        },
      },
      relationships: { author: { $: 'item.authorId' } },
      metadata: {
        space: { $: 'scope.label' },
        version: { $: 'item.version.number' },
      },
      label: 'Pages',
      note: 'CONFLUENCE_GET_PAGES leaves the page body out unless body_format is set, so the list asks for the storage body.',
    },
  },
};
