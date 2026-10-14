import type {
  ComposioRecipe,
  ComposioRecipeObject,
  RecipeReadItem,
} from '@connectors/composio/composio_recipe_types';

const read_issue_with_comments: RecipeReadItem = {
  node_key: 'linear_v2-get_linear_issue-1',
  input: { issue_id: { $: 'item.id' } },
  text: {
    description: { $default: [{ $: 'response.issue.description' }, { $literal: '' }] },
    comments: {
      $map: {
        from: { $: 'response.issue.comments.nodes' },
        to: { $: 'item.body' },
      },
    },
  },
};

const linear_issue_fields = {
  strategy: 'relist_diff',
  read_item: read_issue_with_comments,
  identity: { $: 'item.id' },
  version_signal: { $: 'item.updatedAt' },
  title: { $default: [{ $: 'item.title' }, { $: 'item.identifier' }] },
  item_kind: 'linear_issue',
  container: { id: { $: 'scope.id' } },
  relationships: { assignee: { $: 'item.assignee.id' } },
} satisfies Partial<ComposioRecipeObject>;

function camel_case_page(): ComposioRecipeObject['page'] {
  return {
    items: { $: 'response.issues' },
    next_cursor: { $: 'response.page_info.endCursor' },
    cursor_param: 'after',
  };
}

export const composio_linear_recipe: ComposioRecipe = {
  toolkit_slug: 'LINEAR',
  prompt: 'Pick Linear teams, projects, or a search to keep in sync.',
  dimensions: [
    {
      key: 'teams',
      label: 'Teams',
      shape: 'flat',
      list_scope_options: { node_key: 'linear_v2-list_linear_teams-1', input: { first: 250 } },
      option_mapping: { id: { $: 'item.id' }, label: { $: 'item.name' } },
      allow_select_all: true,
      prompt: 'Pick the Linear teams to sync issues from.',
    },
    {
      key: 'projects',
      label: 'Projects',
      shape: 'flat',
      list_scope_options: { node_key: 'linear_v2-list_linear_projects-1', input: { first: 250 } },
      option_mapping: { id: { $: 'item.id' }, label: { $: 'item.name' } },
      allow_select_all: true,
      prompt: 'Pick the Linear projects to sync issues from.',
    },
    {
      key: 'search',
      label: 'Search',
      shape: 'query',
      search_param: 'query',
      list_scope_options: { node_key: 'linear_v2-search_issues-1' },
      option_mapping: { id: { $: 'item.id' }, label: { $: 'item.title' } },
      placeholder: 'e.g. authentication bug or ENG-123',
      prompt: 'A Linear search; every matching issue is synced and kept in sync.',
    },
  ],
  objects: {
    issue: {
      ...linear_issue_fields,
      label: 'Issues',
      list_items: { node_key: 'linear_v2-list_issues_by_team_id-1', input: { first: 100 } },
      scoped_by: { teams: 'team_id' },
      path: { segments: [{ $: 'scope.label' }] },
      page: {
        items: { $: 'response.issues' },
        next_cursor: { $: 'response.page_info.end_cursor' },
        cursor_param: 'after',
      },
      metadata: {
        identifier: { $: 'item.identifier' },
        status: { $: 'item.state.name' },
        priority: { $: 'item.priority' },
        team: { $: 'scope.label' },
        updated_time: { $: 'item.updatedAt' },
      },
      note: 'LIST_ISSUES_BY_TEAM_ID has no modified-since filter and no url, so relist_diff and no source_url. GET_LINEAR_ISSUE adds the description and the comments. Linear returns the last endCursor on the final page, so the walk ends with one empty page.',
    },
    project_issue: {
      ...linear_issue_fields,
      label: 'Issues (project)',
      list_items: { node_key: 'linear_v2-list_linear_issues-1', input: { first: 100 } },
      scoped_by: { projects: 'project_id' },
      path: {
        segments: [
          { $: 'item.team.name' },
          { $default: [{ $: 'item.project.name' }, { $: 'scope.label' }] },
        ],
      },
      page: camel_case_page(),
      source_url: { $: 'item.url' },
      metadata: {
        identifier: { $: 'item.identifier' },
        status: { $: 'item.state.name' },
        priority: { $: 'item.priority' },
        team: { $: 'item.team.name' },
        project: { $: 'scope.label' },
        updated_time: { $: 'item.updatedAt' },
      },
    },
    issue_search: {
      ...linear_issue_fields,
      label: 'Issues (search)',
      list_items: { node_key: 'linear_v2-search_issues-1', input: { first: 50 } },
      scoped_by: { search: 'query' },
      path: { segments: [{ $: 'item.team.name' }, { $: 'item.project.name' }] },
      page: camel_case_page(),
      source_url: { $: 'item.url' },
      metadata: {
        identifier: { $: 'item.identifier' },
        status: { $: 'item.state.name' },
        team: { $: 'item.team.name' },
        updated_time: { $: 'item.updatedAt' },
      },
    },
  },
};
