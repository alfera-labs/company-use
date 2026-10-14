import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_jira_recipe: ComposioRecipe = {
  toolkit_slug: 'JIRA',
  prompt: 'Pick Jira projects, or a JQL search, to keep in sync.',
  dimensions: [
    {
      key: 'projects',
      label: 'Projects',
      shape: 'flat',
      list_scope_options: {
        node_key: 'jira-get_permitted_projects-1',
        input: { permissions: ['BROWSE_PROJECTS'] },
      },
      option_mapping: {
        id: { $: 'item.key' },
        label: { $: 'item.key' },
      },
      allow_select_all: true,
      prompt: 'Pick the Jira projects to sync issues from.',
    },
    {
      key: 'jql',
      label: 'JQL search',
      shape: 'query',
      search_param: 'jql',
      list_scope_options: { node_key: 'jira-search_issues-1', input: { max_results: 20 } },
      option_mapping: { id: { $: 'item.key' }, label: { $: 'item.summary' } },
      placeholder: 'project = ENG AND status != Done',
      prompt: 'A JQL search; every matching issue is synced and kept in sync.',
    },
  ],
  objects: {
    issue: {
      list_items: { node_key: 'jira-search_issues-1', input: { max_results: 100 } },
      scoped_by: { projects: 'project_key', jql: 'jql' },
      page: {
        items: { $: 'response.issues' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'next_page_token',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.updated' },
      title: { $default: [{ $: 'item.summary' }, { $: 'item.key' }] },
      content: { $default: [{ $: 'item.description' }, { $literal: '' }] },
      item_kind: 'jira_issue',
      container: { id: { $: 'scope.id' } },
      path: { segments: [{ $default: [{ $: 'item.project.name' }, { $: 'scope.label' }] }] },
      source_url: { $: 'item.browser_url' },
      relationships: {
        assignee: { $: 'item.assignee.account_id' },
        reporter: { $: 'item.reporter.account_id' },
      },
      metadata: {
        key: { $: 'item.key' },
        status: { $: 'item.status.name' },
        priority: { $: 'item.priority.name' },
        issue_type: { $: 'item.issue_type.name' },
        project: { $: 'item.project.name' },
        updated_time: { $: 'item.updated' },
      },
      label: 'Issues',
      note: 'JIRA_SEARCH_ISSUES takes updated_after only as YYYY-MM-DD or a relative date, and the runtime sends an ISO time, so this relists and diffs. JIRA_GET_PERMITTED_PROJECTS lists every browsable project but returns only id and key, so the key is the label.',
    },
  },
};
