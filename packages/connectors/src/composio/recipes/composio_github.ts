import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_github_recipe: ComposioRecipe = {
  toolkit_slug: 'GITHUB',
  prompt: 'Pick GitHub repositories and an issue search to keep in sync.',
  dimensions: [
    {
      key: 'repositories',
      label: 'Repositories',
      shape: 'flat',
      list_scope_options: {
        node_key: 'github_v2-list_repositories_for_the_authenticated_user-1',
        input: { per_page: 100, sort: 'updated' },
      },
      option_mapping: {
        id: { $: 'item.full_name' },
        label: { $: 'item.full_name' },
        sublabel: { $: 'item.description' },
      },
      allow_select_all: true,
      prompt: 'Pick the repositories to sync pull requests and issues from.',
    },
    {
      key: 'issue_search',
      label: 'Issue search',
      shape: 'query',
      search_param: 'q',
      placeholder: 'repo:org/name is:issue is:open',
      prompt: 'A GitHub issue search; every match is synced and kept in sync.',
    },
  ],
  objects: {
    pull_request: {
      list_items: {
        node_key: 'github_v2-find_pull_requests-1',
        input: { state: 'all', sort: 'updated', order: 'asc' },
      },
      scoped_by: { repositories: 'repo' },
      page: {
        items: { $: 'response.pull_requests' },
        cursor_kind: 'page_number',
        cursor_param: 'page',
        first_cursor: 1,
        page_size: 100,
        page_size_param: 'per_page',
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.updated_at' },
        param: 'updated_since',
        marker_format: 'iso_time',
      },
      identity: { $: 'item.id' },
      title: { $default: [{ $: 'item.title' }, { $: 'item.number' }] },
      content: { $default: [{ $: 'item.body' }, { $literal: '' }] },
      item_kind: 'github_pull_request',
      container: { id: { $: 'scope.id' } },
      path: { segments: [{ text: { $: 'scope.label' }, split_on: '/' }, { $literal: 'pulls' }] },
      source_url: { $: 'item.html_url' },
      relationships: {
        author: { $default: [{ $: 'item.user.login' }, { $: 'item.author.login' }] },
      },
      metadata: {
        number: { $: 'item.number' },
        state: { $: 'item.state' },
        repository: { $: 'scope.label' },
      },
      label: 'Pull requests',
    },
    issue: {
      list_items: {
        node_key: 'github_v2-search_issues_and_pull_requests-1',
        input: { sort: 'updated', order: 'desc' },
      },
      scoped_by: { issue_search: 'q' },
      page: {
        items: { $: 'response.items' },
        cursor_kind: 'page_number',
        cursor_param: 'page',
        first_cursor: 1,
        page_size: 100,
        page_size_param: 'per_page',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      title: { $default: [{ $: 'item.title' }, { $: 'item.number' }] },
      content: { $default: [{ $: 'item.body' }, { $literal: '' }] },
      item_kind: 'github_issue',
      path: {
        segments: [
          {
            text: { $: 'item.repository_url' },
            strip_prefix: 'https://api.github.com/repos/',
            split_on: '/',
          },
          { $literal: 'issues' },
        ],
      },
      source_url: { $: 'item.html_url' },
      relationships: { author: { $: 'item.user.login' } },
      metadata: {
        number: { $: 'item.number' },
        state: { $: 'item.state' },
        repository_url: { $: 'item.repository_url' },
      },
      label: 'Issues',
    },
  },
};
