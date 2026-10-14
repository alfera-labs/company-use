export type RecipeFixtureCase = {
  toolkit_slug: string;
  dimension: string;
  scope: { selected: { id: string; label: string }[] } | { query: string };
  scope_option?: { id: string; label: string };
  list_input: Record<string, unknown>;
  absent_inputs?: string[];
  record: Record<string, unknown>;
  next_page: { token: string; param: string } | null;
};

const folder_scope = { selected: [{ id: 'scope-1', label: 'Scope One' }] };

export const batch_a_recipe_cases: RecipeFixtureCase[] = [
  {
    toolkit_slug: 'GMAIL',
    dimension: 'labels',
    scope: folder_scope,
    scope_option: { id: 'id-1', label: 'name-1' },
    list_input: { label_ids: ['scope-1'], include_payload: true, verbose: true, max_results: 50 },
    record: {
      external_item_id: 'messageId-1',
      title: 'subject-1',
      content_text: 'messageText-1',
      source_url: 'display_url-1',
    },
    next_page: { token: 'nextPageToken-1', param: 'page_token' },
  },
  {
    toolkit_slug: 'GMAIL',
    dimension: 'search',
    scope: { query: 'newer_than:7d' },
    list_input: { query: 'newer_than:7d', max_results: 50 },
    record: { external_item_id: 'messageId-1', content_text: 'messageText-1' },
    next_page: { token: 'nextPageToken-1', param: 'page_token' },
  },
  {
    toolkit_slug: 'GITHUB',
    dimension: 'repositories',
    scope: folder_scope,
    scope_option: { id: 'full_name-1', label: 'full_name-1' },
    list_input: {
      repo: 'scope-1',
      state: 'all',
      page: 1,
      per_page: 100,
      sort: 'updated',
      order: 'asc',
    },
    record: {
      external_item_id: '1',
      title: 'title-1',
      content_text: 'body-1',
      source_url: 'html_url-1',
    },
    next_page: null,
  },
  {
    toolkit_slug: 'GITHUB',
    dimension: 'issue_search',
    scope: { query: 'repo:org/name is:issue' },
    list_input: { q: 'repo:org/name is:issue', page: 1, per_page: 100 },
    record: { external_item_id: '1', title: 'title-1', content_text: 'body-1' },
    next_page: null,
  },
  {
    toolkit_slug: 'GOOGLEDRIVE',
    dimension: 'folders',
    scope: folder_scope,
    scope_option: { id: 'id-1', label: 'name-1' },
    list_input: { folder_id: 'scope-1', pageSize: 25 },
    absent_inputs: ['folderId', 'modified_after'],
    record: {
      external_item_id: 'id-1',
      external_revision: '2026-10-01T12:00:00Z',
      title: 'name-1',
      content_text: 'description-1',
      source_url: 'webViewLink-1',
    },
    next_page: { token: 'nextPageToken-1', param: 'pageToken' },
  },
  {
    toolkit_slug: 'OUTLOOK',
    dimension: 'folders',
    scope: folder_scope,
    scope_option: { id: 'id-1', label: 'displayName-1' },
    list_input: { folder: 'scope-1', top: 50, response_detail: 'full' },
    record: { external_item_id: 'id-1', title: 'subject-1', content_text: 'content-1' },
    next_page: { token: 'next_page_token-1', param: 'page_token' },
  },
  {
    toolkit_slug: 'OUTLOOK',
    dimension: 'search',
    scope: { query: 'budget report' },
    list_input: { search: 'budget report', top: 50, response_detail: 'full' },
    absent_inputs: ['received_date_time_gt'],
    record: { external_item_id: 'id-1', title: 'subject-1', content_text: 'content-1' },
    next_page: { token: 'next_page_token-1', param: 'page_token' },
  },
  {
    toolkit_slug: 'MICROSOFT_TEAMS',
    dimension: 'chats',
    scope: folder_scope,
    scope_option: { id: 'id-1', label: 'topic-1' },
    list_input: { chat_id: 'scope-1', user_id: 'me', top: 50 },
    absent_inputs: ['created_after'],
    record: { external_item_id: 'scope-1:2026-10-01', title: 'Scope One — 2026-10-01' },
    next_page: { token: 'next_page_token-1', param: 'page_token' },
  },
  {
    toolkit_slug: 'ONE_DRIVE',
    dimension: 'folders',
    scope: folder_scope,
    scope_option: { id: 'id-1', label: 'name-1' },
    list_input: { folder_item_id: 'scope-1', use_me_drive: true, top: 200 },
    record: {
      external_item_id: 'id-1',
      external_revision: 'eTag-1',
      title: 'name-1',
      content_text: 'description-1',
      source_url: 'webUrl-1',
    },
    next_page: { token: 'next_page_token-1', param: 'page_token' },
  },
];
