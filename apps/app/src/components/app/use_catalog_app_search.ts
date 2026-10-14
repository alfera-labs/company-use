// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { search_catalog_apps } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { matches_every_word } from '@/lib/text_search';

const apps_page_size = 100;

/**
 * Searches the app catalog. While the answer to a new search is on its way, the apps already on
 * screen stay and are narrowed by name, so a row that does not match the search never shows.
 */
export function use_catalog_app_search(search_query: string) {
  const apps_query = useInfiniteQuery({
    queryKey: query_keys.apps_search(search_query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      search_catalog_apps({
        query: search_query,
        limit: apps_page_size,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const { data, fetchNextPage, refetch, isPlaceholderData: waits_for_answer } = apps_query;
  const apps = useMemo(() => {
    const listed_apps = (data?.pages ?? []).flatMap((page) => page.items);
    if (!waits_for_answer) return listed_apps;
    return listed_apps.filter((app) => matches_every_word(app.app_display_name, search_query));
  }, [data, waits_for_answer, search_query]);
  const load_more_apps = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const retry_apps = useCallback(() => void refetch(), [refetch]);
  return {
    apps_query,
    apps,
    app_total: waits_for_answer ? apps.length : (data?.pages[0]?.total ?? 0),
    has_more_apps: apps_query.hasNextPage && !waits_for_answer,
    load_more_apps,
    retry_apps,
  };
}
