import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const gmail_recipe: ComposioRecipe = {
  toolkit_slug: 'GMAIL',
  prompt: 'Choose which mail to sync',
  file_fetch: { node_key: 'gmail_v2-get_attachment-1' },
  dimensions: [
    {
      key: 'labels',
      label: 'Labels',
      shape: 'flat',
      list_scope_options: { node_key: 'gmail_v2-list_labels-1' },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $: 'item.name' },
      },
      allow_select_all: true,
    },
    {
      key: 'search',
      label: 'Search',
      shape: 'query',
      placeholder: 'e.g. from:foo newer_than:30d',
      list_scope_options: { node_key: 'gmail_v2-fetch_emails-1', input: { max_results: 10 } },
      search_param: 'query',
      option_mapping: {
        id: { $: 'item.messageId' },
        label: { $default: [{ $: 'item.subject' }, '(no subject)'] },
        sublabel: { $: 'item.sender' },
        preview: { $: 'item.messageText' },
        kind: 'message',
        selectable: false,
      },
    },
  ],
  objects: {
    message: {
      label: 'Email',
      list_items: {
        node_key: 'gmail_v2-fetch_emails-1',
        input: { include_payload: true, verbose: true, max_results: 50 },
      },
      scoped_by: {
        labels: 'label_ids[]',
        search: 'query',
      },
      page: {
        cursor_param: 'page_token',
        items: { $: 'response.messages' },
        next_cursor: { $: 'response.nextPageToken' },
      },
      strategy: 'relist_diff',
      identity: { $: 'item.messageId' },
      title: { $default: [{ $: 'item.subject' }, '(no subject)'] },
      content: { $default: [{ $: 'item.messageText' }, { $literal: '' }] },
      item_kind: 'email',
      source_url: { $: 'item.display_url' },
      container: { id: { $: 'scope.id' } },
      path: {
        parent_chain: {
          parent_ids: { $: 'item.labelIds' },
          folders: {
            node_key: 'gmail_v2-list_labels-1',
            page: { items: { $: 'response.labels' } },
            id: { $: 'item.id' },
            name: { $: 'item.name' },
            when: { value_of: { $: 'item.type' }, is_one_of: ['user'] },
          },
          name_separator: '/',
          known_names: {
            INBOX: 'Inbox',
            SENT: 'Sent',
            DRAFT: 'Drafts',
            SPAM: 'Spam',
            TRASH: 'Trash',
            CHAT: 'Chat',
          },
          root_name: 'All Mail',
        },
      },
      files: {
        $map: {
          from: { $: 'item.attachmentList' },
          to: {
            id: {
              $join: { parts: [{ $: 'parent.messageId' }, { $: 'item.filename' }], separator: '/' },
            },
            name: { $: 'item.filename' },
            mime_type: { $: 'item.mimeType' },
            message_id: { $: 'parent.messageId' },
            attachment_id: { $: 'item.attachmentId' },
          },
        },
      },
      file_fetch_input: {
        message_id: { $: 'file.message_id' },
        attachment_id: { $: 'file.attachment_id' },
        file_name: { $: 'file.name' },
      },
      metadata: {
        from: { $: 'item.sender' },
        to: { $: 'item.to' },
        date: { $: 'item.messageTimestamp' },
        labels: { $: 'item.labelIds' },
        thread_id: { $: 'item.threadId' },
      },
      note: 'Same behaviour as the native gmail recipe (packages/connectors/src/apps/gmail/app.json), on Composio GMAIL_FETCH_EMAILS/GMAIL_LIST_LABELS. relist_diff for the same reason as the native node: Gmail list has no modified-since filter. GMAIL_FETCH_EMAILS returns messageText for every message on the page (verbose and include_payload), so one list call reads 50 bodies and no per-message read is needed.',
    },
  },
};
