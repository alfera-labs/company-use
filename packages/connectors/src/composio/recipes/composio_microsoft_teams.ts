import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_microsoft_teams_recipe: ComposioRecipe = {
  toolkit_slug: 'MICROSOFT_TEAMS',
  prompt: 'Pick the Microsoft Teams chat to keep in sync.',
  dimensions: [
    {
      key: 'chats',
      label: 'Chats',
      shape: 'flat',
      list_scope_options: {
        node_key: 'microsoft_teams-chats_get_all_chats-1',
        input: { user_id: 'me', top: 50 },
      },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $default: [{ $: 'item.topic' }, { $: 'item.id' }] },
      },
      allow_select_all: true,
      prompt: 'Pick the Teams chats to sync messages from. Each chat becomes one document per day.',
    },
  ],
  objects: {
    chat_day: {
      list_items: {
        node_key: 'microsoft_teams-list_user_chat_messages-1',
        input: { user_id: 'me', top: 50 },
      },
      scoped_by: { chats: 'chat_id' },
      page: {
        items: { $: 'response.value' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'page_token',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.last_modified_date_time' },
      title: { $: 'item.id' },
      content: { $default: [{ $: 'item.body.content' }, { $literal: '' }] },
      item_kind: 'microsoft_teams_chat_day',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      bucket: { by: 'day', of: { $: 'item.created_date_time' } },
      relationships: { author: { $: 'item.from.user.id' } },
      metadata: {
        chat_id: { $: 'scope.id' },
        created_time: { $: 'item.created_date_time' },
      },
      label: 'Chat days',
      note: 'MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES requires user_id; the recipe sends me, the signed-in user, as the chats list does. The node has no created-after input (only a raw OData filter string), so this re-lists each chat and diffs by message id until the runtime can send a watermark inside a filter expression.',
    },
  },
};
