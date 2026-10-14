import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const sentry_recipe: ComposioRecipe = {
  toolkit_slug: 'SENTRY',
  prompt: 'Pick the Sentry organizations whose open issues to keep in sync.',
  dimensions: [
    {
      key: 'organizations',
      label: 'Organizations',
      shape: 'flat',
      list_scope_options: { node_key: 'sentry-list_organizations-1' },
      option_mapping: {
        id: { $: 'item.slug' },
        label: { $default: [{ $: 'item.name' }, { $: 'item.slug' }] },
        kind: 'organization',
      },
      allow_select_all: true,
      prompt: 'Pick the Sentry organizations to sync unresolved issues from.',
    },
  ],
  objects: {
    issue: {
      label: 'Issues',
      list_items: {
        node_key: 'sentry-list_an_organizations_issues-1',
        input: { limit: 100, query: 'is:unresolved', sort: 'date' },
      },
      scoped_by: { organizations: 'organization_id_or_slug' },
      page: { items: { $: 'response' } },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.lastSeen' },
      title: { $default: [{ $: 'item.title' }, { $: 'item.shortId' }] },
      content: {
        culprit: { $: 'item.culprit' },
        level: { $: 'item.level' },
        status: { $: 'item.status' },
        events: { $: 'item.count' },
        users: { $: 'item.userCount' },
        first_seen: { $: 'item.firstSeen' },
        last_seen: { $: 'item.lastSeen' },
      },
      item_kind: 'sentry_issue',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      source_url: { $: 'item.permalink' },
      metadata: {
        short_id: { $: 'item.shortId' },
        level: { $: 'item.level' },
        status: { $: 'item.status' },
        project: { $: 'item.project.slug' },
        last_seen: { $: 'item.lastSeen' },
      },
      note: 'SENTRY_LIST_AN_ORGANIZATIONS_ISSUES needs only the organization, so the organization is the scope. Its body is a bare array and Sentry pages through Link headers that Composio does not return, so one call reads the 100 most recently seen unresolved issues and relists them.',
    },
  },
};
