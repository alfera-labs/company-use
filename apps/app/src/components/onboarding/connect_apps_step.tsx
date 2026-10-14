import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Loader2, Search } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  create_connection,
  list_catalog_apps_by_keys,
  list_connections,
  search_catalog_apps,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { CatalogApp } from '@/lib/api/types';
import { app_icon_url, app_matches_alias, first_connection_profile } from '@/lib/catalog_app';
import { build_connection_setup_return_url } from '@/lib/connection_setup_return';

const apps_page_size = 24;

const featured_app_keys = [
  'gmail',
  'slack',
  'notion',
  'googlesheets',
  'googledrive',
  'hubspot',
  'salesforce',
  'stripe',
  'github',
];

export function ConnectAppsStep({
  agentLabel,
  isFinishing,
  onAdvance,
}: {
  agentLabel: string;
  isFinishing: boolean;
  onAdvance: () => void;
}) {
  const [browse_all, set_browse_all] = useState(false);
  const [search, set_search] = useState('');
  const deferred_search = useDeferredValue(search);
  const [connecting_app_id, set_connecting_app_id] = useState<string | null>(null);

  const featured_query = useQuery({
    queryKey: query_keys.onboarding_featured_apps(),
    queryFn: () => list_catalog_apps_by_keys(featured_app_keys),
  });
  const apps_query = useInfiniteQuery({
    queryKey: query_keys.onboarding_apps(deferred_search),
    enabled: browse_all,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      search_catalog_apps({
        query: deferred_search,
        limit: apps_page_size,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const connections_query = useQuery({
    queryKey: query_keys.connections(),
    queryFn: list_connections,
  });
  const { refetch: refetch_connections } = connections_query;

  const poll_timer = useRef<number | null>(null);
  const stop_connection_poll = useCallback(() => {
    if (poll_timer.current) {
      window.clearInterval(poll_timer.current);
      poll_timer.current = null;
    }
  }, []);
  const start_connection_poll = useCallback(() => {
    stop_connection_poll();
    let runs = 0;
    poll_timer.current = window.setInterval(() => {
      runs += 1;
      void refetch_connections();
      if (runs >= 12) stop_connection_poll();
    }, 1500);
  }, [refetch_connections, stop_connection_poll]);
  useEffect(() => stop_connection_poll, [stop_connection_poll]);

  const featured_apps = useMemo(() => {
    const found = featured_query.data ?? [];
    return featured_app_keys
      .map((key) => found.find((app) => app_matches_alias(app, key)))
      .filter((app): app is CatalogApp => Boolean(app));
  }, [featured_query.data]);
  const search_apps = useMemo(
    () => apps_query.data?.pages.flatMap((page) => page.items) ?? [],
    [apps_query.data],
  );
  const connected_app_ids = useMemo(() => {
    const ids = new Set<string>();
    for (const connection of connections_query.data ?? []) {
      if (connection.connection_status === 'active') ids.add(connection.app_id);
    }
    return ids;
  }, [connections_query.data]);

  const connect_mutation = useMutation({
    mutationFn: ({ app }: { app: CatalogApp }) => {
      const profile = first_connection_profile(app);
      return create_connection({
        app_id: app.app_id,
        access_type: 'shared',
        ...(profile?.provider_key ? { provider_key: profile.provider_key } : {}),
        ...(profile?.provider_config_key
          ? { provider_config_key: profile.provider_config_key }
          : {}),
        ...(profile?.connection_profile_key
          ? { connection_profile_key: profile.connection_profile_key }
          : {}),
        redirect_uri: build_connection_setup_return_url(window.location.origin),
      });
    },
    onMutate: ({ app }) => set_connecting_app_id(app.app_id),
    onSuccess: (result) => {
      if (open_connection_setup(result.start_url)) start_connection_poll();
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not start the connection.')),
    onSettled: () => set_connecting_app_id(null),
  });

  function render_tool(app: CatalogApp) {
    const is_connected = connected_app_ids.has(app.app_id);
    const is_connecting = connecting_app_id === app.app_id;
    const icon_url = app_icon_url(app);
    return (
      <button
        type="button"
        className="ob-tool"
        key={app.app_id}
        data-connected={is_connected}
        disabled={is_connected || is_connecting}
        aria-label={
          is_connected ? `${app.app_display_name} connected` : `Connect ${app.app_display_name}`
        }
        onClick={() => connect_mutation.mutate({ app })}
      >
        <span
          className="ob-tool__mark"
          style={icon_url ? { backgroundImage: `url("${icon_url}")` } : undefined}
          aria-hidden="true"
        >
          {icon_url ? '' : app.app_display_name.slice(0, 1).toUpperCase()}
        </span>
        <span className="ob-tool__name">{app.app_display_name}</span>
        {is_connecting ? (
          <Loader2 className="ob-tool__state size-4 animate-spin" aria-hidden="true" />
        ) : is_connected ? (
          <Check className="ob-tool__state size-4" aria-hidden="true" />
        ) : null}
      </button>
    );
  }

  return (
    <div className="ob-step ob-step--wide ob-animate">
      <div className="ob-head">
        <h1 className="ob-title">
          Give {agentLabel} <span className="ob-accent">tools to work with</span>
        </h1>
        <p className="ob-subtitle">
          Connect the tools your team already uses. Pick a few to start, then add more anytime.
        </p>
      </div>

      {browse_all ? (
        <>
          <button type="button" className="ob-back" onClick={() => set_browse_all(false)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to popular tools
          </button>

          <div className="ob-search">
            <Search className="size-4" aria-hidden="true" />
            <input
              type="search"
              value={search}
              placeholder="Search 3,000+ tools…"
              onChange={(event) => set_search(event.target.value)}
              aria-label="Search tools"
              // biome-ignore lint/a11y/noAutofocus: focus the search the moment the user opens it
              autoFocus
            />
          </div>

          {apps_query.isLoading ? (
            <div className="ob-empty">Loading tools…</div>
          ) : search_apps.length === 0 ? (
            <div className="ob-empty">No tools match “{search}”.</div>
          ) : (
            <div className="ob-tool-grid">{search_apps.map(render_tool)}</div>
          )}

          {apps_query.hasNextPage ? (
            <div className="ob-list__more">
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={apps_query.isFetchingNextPage}
                onClick={() => void apps_query.fetchNextPage()}
              >
                {apps_query.isFetchingNextPage ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="ob-tools-label">Popular</p>
          <div className="ob-tool-grid">
            {featured_query.isLoading
              ? featured_app_keys.map((key) => (
                  <div className="ob-tool" key={`skeleton-${key}`} aria-hidden="true">
                    <Skeleton className="size-[22px] rounded-[5px]" />
                    <Skeleton className="h-3.5 w-24 max-w-full" />
                    <span />
                  </div>
                ))
              : featured_apps.map(render_tool)}
          </div>
          <button
            type="button"
            className="ob-tool ob-tool--more"
            onClick={() => set_browse_all(true)}
          >
            <span className="ob-tool__mark" aria-hidden="true">
              <Search className="size-4" aria-hidden="true" />
            </span>
            <span className="ob-tool__name">Browse 3,000+ more tools</span>
            <ArrowRight className="ob-tool__state size-4" aria-hidden="true" />
          </button>
        </>
      )}

      <p className="ob-hint">
        Pick none if you like. I'll ask for a tool the moment a task actually needs one.
      </p>

      <div className="ob-actions">
        <Button
          aria-busy={isFinishing}
          className="h-12 w-full text-[15px]"
          disabled={isFinishing}
          type="button"
          onClick={onAdvance}
        >
          {isFinishing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Setting up your coworker…
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function open_connection_setup(start_url: string | null): boolean {
  if (!start_url) return false;
  window.open(start_url, '_blank', 'noopener,noreferrer');
  return true;
}
