import type {
  ComposioRecipe,
  ComposioRecipeObject,
} from '@connectors/composio/composio_recipe_types';

const outlook_message_fields: Pick<
  ComposioRecipeObject,
  'identity' | 'title' | 'content' | 'item_kind' | 'relationships' | 'source_url'
> = {
  identity: { $: 'item.id' },
  title: { $default: [{ $: 'item.subject' }, { $: 'item.id' }] },
  content: { $default: [{ $: 'item.body.content' }, { $: 'item.bodyPreview' }, { $literal: '' }] },
  item_kind: 'outlook_message',
  relationships: { author: { $: 'item.from.emailAddress.address' } },
  source_url: { $: 'item.webLink' },
};

export const composio_outlook_recipe: ComposioRecipe = {
  toolkit_slug: 'OUTLOOK',
  prompt: 'Pick Outlook mail folders, or a search, to keep in sync.',
  dimensions: [
    {
      key: 'folders',
      label: 'Folders',
      shape: 'flat',
      list_scope_options: {
        node_key: 'microsoft_outlook-list_mail_folders-1',
        input: { top: 100 },
      },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $: 'item.displayName' },
      },
      allow_select_all: true,
      prompt: 'Pick the Outlook folders to sync messages from.',
    },
    {
      key: 'search',
      label: 'Search',
      shape: 'query',
      search_param: 'search',
      placeholder: 'from:alice@example.com hasAttachments:true',
      prompt: 'An Outlook search; every matching message is synced and kept in sync.',
    },
  ],
  objects: {
    message: {
      list_items: {
        node_key: 'microsoft_outlook-list_messages-1',
        input: { top: 50, response_detail: 'full' },
      },
      scoped_by: { folders: 'folder' },
      page: {
        items: { $: 'response.value' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'page_token',
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.receivedDateTime' },
        param: 'received_date_time_gt',
        marker_format: 'iso_time',
      },
      ...outlook_message_fields,
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      metadata: {
        to: { $: 'item.toRecipients' },
        received_time: { $: 'item.receivedDateTime' },
        conversation_id: { $: 'item.conversationId' },
        folder: { $: 'scope.label' },
      },
      label: 'Messages',
    },
    search_message: {
      list_items: {
        node_key: 'microsoft_outlook-list_messages-1',
        input: { top: 50, response_detail: 'full' },
      },
      scoped_by: { search: 'search' },
      page: {
        items: { $: 'response.value' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'page_token',
      },
      strategy: 'relist_diff',
      ...outlook_message_fields,
      metadata: {
        to: { $: 'item.toRecipients' },
        received_time: { $: 'item.receivedDateTime' },
        conversation_id: { $: 'item.conversationId' },
      },
      label: 'Search matches',
      note: 'Graph $search cannot be combined with $filter, so a search scope re-lists and diffs instead of sending the received_date_time_gt watermark.',
    },
  },
};
