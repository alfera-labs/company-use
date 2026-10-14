import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const canva_recipe: ComposioRecipe = {
  toolkit_slug: 'CANVA',
  prompt: 'Sync Canva designs',
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
    design: {
      label: 'Design',
      list_items: {
        node_key: 'canva-list_user_designs-1',
        input: { limit: 100, ownership: 'any', sort_by: 'modified_descending' },
      },
      scoped_by: { account: null },
      page: {
        cursor_param: 'continuation',
        items: { $: 'response.items' },
        next_cursor: { $: 'response.continuation' },
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.updated_at' },
      title: { $default: [{ $: 'item.title' }, { $: 'item.id' }] },
      content: {
        title: { $: 'item.title' },
        page_count: { $: 'item.page_count' },
        created_at: { $: 'item.created_at' },
        updated_at: { $: 'item.updated_at' },
      },
      item_kind: 'design',
      metadata: {
        thumbnail_url: { $: 'item.thumbnail.url' },
        owner_user_id: { $: 'item.owner.user_id' },
        page_count: { $: 'item.page_count' },
      },
      source_url: { $: 'item.urls.view_url' },
      note: 'CANVA_LIST_USER_DESIGNS lists owned and shared designs, 100 per page, and pages by the continuation token. It has no modified-since filter, so the walk relists and diffs by id. Canva exposes no text body for a design, so content is the title and page facts.',
    },
  },
};
