export type IntegrationsTab = 'integrations' | 'connected';

export function integrations_search_placeholder(
  active_tab: IntegrationsTab,
  has_app_catalogue: boolean,
) {
  if (active_tab === 'connected') return 'Search connections';
  return has_app_catalogue ? 'Search 3,000+ integrations' : 'Search integrations';
}

/**
 * Whether an app list with no app in it says so. An install with no app catalogue already says
 * above the list why no app can connect, so there the list says nothing until a search finds none.
 */
export function shows_the_app_list(has_app_catalogue: boolean, search_query: string) {
  return has_app_catalogue || search_query !== '';
}
