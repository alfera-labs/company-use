import type { ComposioRecipe, RecipeReadItem } from '@connectors/composio/composio_recipe_types';

const read_page_markdown: RecipeReadItem = {
  node_key: 'notion_v2-get_page_markdown-1',
  input: { page_id: { $: 'item.id' } },
  text: { $default: [{ $: 'response.markdown' }, { $literal: '' }] },
};

const page_title = {
  $default: [
    { $: 'item.properties.title.title.0.plain_text' },
    { $: 'item.properties.Name.title.0.plain_text' },
    { $: 'item.id' },
  ],
};

const notion_parent_id = {
  $default: [
    { $: 'item.parent.page_id' },
    { $: 'item.parent.database_id' },
    { $: 'item.parent.data_source_id' },
    { $: 'item.parent.block_id' },
  ],
};

const notion_folder_name = {
  $default: [
    { $: 'item.title.0.plain_text' },
    { $: 'item.properties.title.title.0.plain_text' },
    { $: 'item.properties.Name.title.0.plain_text' },
    { $: 'item.id' },
  ],
};

export const composio_notion_recipe: ComposioRecipe = {
  toolkit_slug: 'NOTION',
  prompt: 'Pick Notion databases, or a search, to keep in sync.',
  dimensions: [
    {
      key: 'databases',
      label: 'Databases',
      shape: 'flat',
      list_scope_options: {
        node_key: 'notion_v2-search_notion_page-1',
        input: { filter_value: 'database' },
      },
      search: {
        node_key: 'notion_v2-search_notion_page-1',
        input: { filter_value: 'database' },
        query_param: 'query',
      },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $default: [{ $: 'item.title.0.plain_text' }, { $: 'item.id' }] },
      },
      allow_select_all: true,
      prompt: 'Pick the Notion databases to sync rows from.',
    },
    {
      key: 'search',
      label: 'Search',
      shape: 'query',
      search_param: 'query',
      list_scope_options: {
        node_key: 'notion_v2-search_notion_page-1',
        input: { filter_value: 'page', page_size: 20 },
      },
      option_mapping: { id: { $: 'item.id' }, label: { $: 'item.url' } },
      placeholder: 'quarterly plan',
      prompt: 'A Notion search; every matching page is synced and kept in sync.',
    },
  ],
  objects: {
    database_row: {
      list_items: { node_key: 'notion_v2-query_database-1' },
      scoped_by: { databases: 'database_id' },
      page: {
        items: { $: 'response.results' },
        next_cursor: { $: 'response.next_cursor' },
        cursor_param: 'start_cursor',
      },
      strategy: 'relist_diff',
      tombstone: { $: 'item.archived' },
      identity: { $: 'item.id' },
      read_item: read_page_markdown,
      version_signal: { $: 'item.last_edited_time' },
      title: page_title,
      item_kind: 'notion_database_row',
      container: { id: { $: 'scope.id' } },
      path: {
        parent_chain: {
          parent_ids: notion_parent_id,
          folders: {
            node_key: 'notion_v2-search_notion_page-1',
            input: { page_size: 100 },
            page: {
              items: { $: 'response.results' },
              next_cursor: { $: 'response.next_cursor' },
              cursor_param: 'start_cursor',
            },
            id: { $: 'item.id' },
            name: notion_folder_name,
            parent_id: notion_parent_id,
          },
          root_name: 'Workspace',
        },
      },
      source_url: { $: 'item.url' },
      relationships: { author: { $: 'item.created_by.id' } },
      metadata: { database_id: { $: 'scope.id' } },
      label: 'Database rows',
    },
    page: {
      list_items: {
        node_key: 'notion_v2-search_notion_page-1',
        input: { filter_value: 'page' },
      },
      scoped_by: { search: 'query' },
      page: {
        items: { $: 'response.results' },
        next_cursor: { $: 'response.next_cursor' },
        cursor_param: 'start_cursor',
      },
      strategy: 'relist_diff',
      tombstone: { $: 'item.archived' },
      identity: { $: 'item.id' },
      read_item: read_page_markdown,
      version_signal: { $: 'item.last_edited_time' },
      title: page_title,
      item_kind: 'notion_page',
      path: {
        parent_chain: {
          parent_ids: notion_parent_id,
          folders: {
            node_key: 'notion_v2-search_notion_page-1',
            input: { page_size: 100 },
            page: {
              items: { $: 'response.results' },
              next_cursor: { $: 'response.next_cursor' },
              cursor_param: 'start_cursor',
            },
            id: { $: 'item.id' },
            name: notion_folder_name,
            parent_id: notion_parent_id,
          },
          root_name: 'Workspace',
        },
      },
      source_url: { $: 'item.url' },
      relationships: { author: { $: 'item.created_by.id' } },
      label: 'Pages',
      note: 'Notion page properties are a user-defined map, so the title paths stay unverifiable by schema: a workspace page names its title property title, a database row usually Name. NOTION_GET_PAGE_MARKDOWN reads the page body; Notion has no batch body read.',
    },
  },
};
