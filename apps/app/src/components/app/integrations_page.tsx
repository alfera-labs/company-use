import { format_error_message } from '@coworker/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@coworker/ui/components/alert-dialog';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@coworker/ui/components/tabs';
import { cn } from '@coworker/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Unplug,
} from 'lucide-react';
import type * as React from 'react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AddMcpServerDialog } from '@/components/app/add_mcp_server_dialog';
import { BrainSummaryCard } from '@/components/app/brain/brain_summary_card';
import {
  type ConnectAnythingKind,
  ConnectAnythingSection,
} from '@/components/app/connect_anything_section';
import { ConnectionOrgLine, SiblingAudienceNote } from '@/components/app/connection_org_line';
import type { IntegrationsTab } from '@/components/app/integrations_catalogue_view';
import { EmptyState, NoAppsToList } from '@/components/app/integrations_empty_states';
import { PageControls } from '@/components/app/integrations_page_controls';
import { use_catalog_app_search } from '@/components/app/use_catalog_app_search';
import {
  ConnectAccountDialog,
  type ConnectionAccessType,
} from '@/components/connections/connect_account_dialog';
import {
  ConnectionCannotWorkNote,
  read_connection_detail,
} from '@/components/connections/connection_status';
import { IntegrationDetail } from '@/components/connections/integration_detail';
import { use_reconnect_connection } from '@/components/connections/use_reconnect_connection';
import {
  read_catalog_request_status,
  should_offer_website_fallback,
  WebsiteFallbackPanel,
} from '@/components/connections/website_fallback_panel';
import { ConnectAppDialog } from '@/components/credentials/connect_app_dialog';
import {
  type CatalogApp,
  type Connection,
  type ConnectionSetupResult,
  type ConnectionSetupState,
  complete_connection_setup,
  create_connection,
  type IntegrationApp,
  list_catalog_apps_by_keys,
  list_connections,
  relative_time,
  revoke_connection,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { app_matches_alias } from '@/lib/catalog_app';
import {
  build_connection_setup_return_url,
  type ConnectionSetupReturnEvent,
  subscribe_to_connection_setup_returns,
} from '@/lib/connection_setup_return';
import { start_website_task, website_browsing_guide_url } from '@/lib/website_task_request';

type ConnectionSetupNotice = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  description: string;
  action_url?: string;
};

type ConnectionProfile = {
  provider_key?: string;
  provider_config_key?: string;
  connection_profile_key?: string;
};

type AppDisplaySource = {
  metadata: unknown;
  display_config: unknown;
};

type AppCatalogMetadata = {
  icon_url?: string;
  description?: string;
  provider_configs?: Array<{
    provider_key?: string;
    provider_config_key?: string;
    status: string;
    connection_profiles: Array<{ connection_profile_key?: string; status: string }>;
  }>;
};

const no_apps: CatalogApp[] = [];
const no_connections: Connection[] = [];
const popular_app_keys = [
  'gmail',
  'slack',
  'googledrive',
  'googlesheets',
  'googlecalendar',
  'notion',
  'hubspot',
  'salesforce',
  'stripe',
  'github',
  'googleanalytics',
  'googleads',
  'linkedin',
  'microsoftoutlook',
  'microsoftteams',
  'dropbox',
  'airtable',
  'zoom',
  'asana',
  'zendesk',
] as const;
const loading_row_keys = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const setup_refresh_interval_ms = 1500;
const setup_refresh_max_runs = 8;

export function IntegrationsPage() {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const [active_tab, set_active_tab] = useState<IntegrationsTab>('integrations');
  const [search_query, set_search_query] = useState('');
  const deferred_search_query = useDeferredValue(search_query);
  const [setup_notice, set_setup_notice] = useState<ConnectionSetupNotice | null>(null);
  const [selected_app, set_selected_app] = useState<IntegrationApp | null>(null);
  const [connecting_app_id, set_connecting_app_id] = useState<string | null>(null);
  const [access_app, set_access_app] = useState<IntegrationApp | null>(null);
  const [reconnecting_connection_id, set_reconnecting_connection_id] = useState<string | null>(
    null,
  );
  const [revoking_connection_id, set_revoking_connection_id] = useState<string | null>(null);
  const [connecting_kind, set_connecting_kind] = useState<ConnectAnythingKind | null>(null);
  const setup_refresh_timer = useRef<number | null>(null);

  const refresh_connection_setup_queries = useCallback(() => {
    void query_client.invalidateQueries({ queryKey: query_keys.connections() });
    void query_client.invalidateQueries({ queryKey: query_keys.apps_search() });
  }, [query_client]);

  const stop_connection_setup_refresh = useCallback(() => {
    if (!setup_refresh_timer.current) return;
    window.clearInterval(setup_refresh_timer.current);
    setup_refresh_timer.current = null;
  }, []);

  const start_connection_setup_refresh = useCallback(() => {
    stop_connection_setup_refresh();
    refresh_connection_setup_queries();

    let run_count = 0;
    setup_refresh_timer.current = window.setInterval(() => {
      run_count += 1;
      refresh_connection_setup_queries();
      if (run_count >= setup_refresh_max_runs) stop_connection_setup_refresh();
    }, setup_refresh_interval_ms);
  }, [refresh_connection_setup_queries, stop_connection_setup_refresh]);

  const { apps_query, apps, app_total, has_more_apps, load_more_apps, retry_apps } =
    use_catalog_app_search(deferred_search_query);
  const popular_apps_query = useQuery({
    queryKey: query_keys.popular_integration_apps(),
    queryFn: () => list_catalog_apps_by_keys([...popular_app_keys]),
    staleTime: 30 * 60_000,
  });
  const connections_query = useQuery({
    queryKey: query_keys.connections(),
    queryFn: list_connections,
  });

  const popular_apps = useMemo(
    () => order_apps_by_keys(popular_apps_query.data ?? [], popular_app_keys),
    [popular_apps_query.data],
  );
  const popular_app_ids = useMemo(
    () => new Set(popular_apps.map((app) => app.app_id)),
    [popular_apps],
  );
  const catalog_apps = useMemo(
    () => (deferred_search_query ? apps : apps.filter((app) => !popular_app_ids.has(app.app_id))),
    [apps, deferred_search_query, popular_app_ids],
  );
  const shows_catalog_skeleton =
    apps_query.isLoading || (apps_query.isPlaceholderData && catalog_apps.length === 0);
  const connections = connections_query.data ?? no_connections;
  const live_connection_rows = useMemo(() => live_connections(connections), [connections]);
  const connections_by_app = useMemo(
    () => group_connections_by_app(live_connection_rows),
    [live_connection_rows],
  );
  const visible_connection_rows = useMemo(
    () => filter_connections(connected_connections(live_connection_rows), search_query),
    [live_connection_rows, search_query],
  );

  const offers_website_fallback = should_offer_website_fallback({
    is_integrations_tab: active_tab === 'integrations',
    search_query: deferred_search_query,
    catalog_status: read_catalog_request_status(apps_query),
    matching_integration_count: catalog_apps.length,
  });

  const clear_search = useCallback(() => set_search_query(''), []);
  const open_website_task = useCallback(() => {
    navigate({ href: start_website_task(deferred_search_query) });
  }, [deferred_search_query, navigate]);

  const create_connection_mutation = useMutation({
    mutationFn: ({
      app,
      connection_name,
      access_type,
    }: {
      app: IntegrationApp;
      connection_name?: string;
      access_type: ConnectionAccessType;
    }) => {
      const profile = first_connection_profile(app);
      return create_connection({
        app_id: app.app_id,
        access_type,
        ...(connection_name ? { connection_name } : {}),
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
    onSuccess: async (result) => {
      show_connection_setup_result(result, 'Connection setup started', set_setup_notice);
      open_connection_setup(result.start_url);
      start_connection_setup_refresh();
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
      await query_client.invalidateQueries({ queryKey: query_keys.apps_search() });
    },
    onError: (error) => {
      show_connection_setup_error(error, 'Connection setup failed', set_setup_notice);
      toast.error(format_error_message(error, 'Connection setup failed'));
    },
    onSettled: () => set_connecting_app_id(null),
  });

  const reconnect_connection_mutation = use_reconnect_connection({
    on_busy_connection: set_reconnecting_connection_id,
    on_setup_started: (result) => {
      show_connection_setup_result(result, 'Reconnect setup started', set_setup_notice);
      open_connection_setup(result.start_url);
      start_connection_setup_refresh();
    },
    on_error: (error) => {
      show_connection_setup_error(error, 'Reconnect failed', set_setup_notice);
      toast.error(format_error_message(error, 'Reconnect failed'));
    },
  });

  const revoke_connection_mutation = useMutation({
    mutationFn: revoke_connection,
    onMutate: (connection_id) => set_revoking_connection_id(connection_id),
    onSuccess: async () => {
      set_setup_notice({
        tone: 'success',
        title: 'Connection disconnected',
        description: 'The workspace can no longer use this account for tools.',
      });
      toast.success('Connection disconnected');
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    },
    onError: (error) => {
      show_connection_setup_error(error, 'Disconnect failed', set_setup_notice);
      toast.error(format_error_message(error, 'Disconnect failed'));
    },
    onSettled: () => set_revoking_connection_id(null),
  });

  const complete_connection_setup_mutation = useMutation({
    mutationFn: complete_connection_setup,
    onSuccess: async (connection) => {
      stop_connection_setup_refresh();
      set_setup_notice({
        tone: 'success',
        title: 'Connection connected',
        description: connection.external_account_name
          ? `${connection.connection_name ?? 'Integration'} is connected to ${connection.external_account_name}.`
          : `${connection.connection_name ?? 'Integration'} is connected in this workspace.`,
      });
      toast.success('Connection connected');
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
      await query_client.invalidateQueries({ queryKey: query_keys.apps_search() });
    },
    onError: (error) => {
      set_setup_notice({
        tone: 'warning',
        title: 'Connection is still syncing',
        description: format_error_message(
          error,
          'The provider returned to the app, but the account is not visible yet.',
        ),
      });
      start_connection_setup_refresh();
      toast.error('Connection is still syncing');
    },
  });

  const on_connection_setup_return = useCallback(
    (event: ConnectionSetupReturnEvent) => {
      window.focus();
      set_active_tab('connected');
      if (event.status === 'error') {
        set_setup_notice({
          tone: 'error',
          title: 'Connection setup failed',
          description: event.error_message ?? 'The provider returned an error.',
        });
        toast.error(event.error_message ?? 'Connection setup failed');
        start_connection_setup_refresh();
        return;
      }

      if (!event.connection_id) {
        set_setup_notice({
          tone: 'warning',
          title: 'Connection returned',
          description: 'The integration is refreshing in this workspace.',
        });
        start_connection_setup_refresh();
        return;
      }

      set_setup_notice({
        tone: 'warning',
        title: 'Finalizing connection',
        description:
          'The account returned from the provider. We are syncing it into this workspace.',
      });
      start_connection_setup_refresh();
      complete_connection_setup_mutation.mutate(event.connection_id);
    },
    [complete_connection_setup_mutation, start_connection_setup_refresh],
  );

  useEffect(() => {
    return subscribe_to_connection_setup_returns((event) => {
      on_connection_setup_return(event);
    });
  }, [on_connection_setup_return]);

  useEffect(() => {
    return () => stop_connection_setup_refresh();
  }, [stop_connection_setup_refresh]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col pb-10">
      {setup_notice ? <ConnectionSetupCallout notice={setup_notice} /> : null}
      {selected_app ? (
        <IntegrationDetail
          app={selected_app}
          connections={connections_by_app.get(selected_app.app_id) ?? []}
          description={
            app_description(selected_app) ??
            `${selected_app.app_display_name} accounts connected to this workspace.`
          }
          iconUrl={app_icon_url(selected_app)}
          onAddAccount={() => set_access_app(selected_app)}
          onBack={() => set_selected_app(null)}
        />
      ) : (
        <>
          <h1 className="mt-1 text-xl font-semibold text-balance">Integrations</h1>

          <Tabs
            value={active_tab}
            className="mt-7 gap-5"
            onValueChange={(value) => {
              if (value === 'integrations' || value === 'connected') set_active_tab(value);
            }}
          >
            <TabsList variant="line">
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
              <TabsTrigger value="connected">Connected</TabsTrigger>
            </TabsList>

            <PageControls
              activeTab={active_tab}
              appCount={app_total}
              connectedCount={visible_connection_rows.length}
              searchQuery={search_query}
              onSearchChange={set_search_query}
            />

            <TabsContent value="integrations">
              {deferred_search_query ? null : (
                <div className="mb-5" data-tour="integrations-connect">
                  <ConnectAnythingSection onSelect={set_connecting_kind} />
                </div>
              )}
              <CatalogGrid
                apps={catalog_apps}
                popularApps={deferred_search_query ? no_apps : popular_apps}
                connectionsByApp={connections_by_app}
                connectingAppId={connecting_app_id}
                isError={apps_query.isError}
                isFetchingNextPage={apps_query.isFetchingNextPage}
                isLoading={shows_catalog_skeleton}
                hasNextPage={has_more_apps}
                searchQuery={deferred_search_query}
                shownCount={apps.length}
                total={app_total}
                websiteFallback={
                  offers_website_fallback ? (
                    <WebsiteFallbackPanel
                      learn_more_href={website_browsing_guide_url()}
                      on_use_website={open_website_task}
                      website_name={deferred_search_query}
                    />
                  ) : null
                }
                onClearSearch={clear_search}
                onConnect={set_access_app}
                onOpen={set_selected_app}
                onLoadMore={load_more_apps}
                onRetry={retry_apps}
              />
            </TabsContent>

            <TabsContent value="connected">
              <BrainSummaryCard />
              <ConnectedGrid
                connections={visible_connection_rows}
                isError={connections_query.isError}
                isLoading={connections_query.isLoading}
                reconnectingConnectionId={reconnecting_connection_id}
                revokingConnectionId={revoking_connection_id}
                searchQuery={search_query}
                onBrowse={() => set_active_tab('integrations')}
                onClearSearch={clear_search}
                onOpenConnection={(connection_id) =>
                  navigate({ href: `/integrations/${connection_id}` })
                }
                onReconnect={(connection_id) => reconnect_connection_mutation.mutate(connection_id)}
                onRetry={() => void connections_query.refetch()}
                onRevoke={(connection_id) => revoke_connection_mutation.mutate(connection_id)}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <ConnectAccountDialog
        app={access_app}
        isConnecting={create_connection_mutation.isPending}
        onClose={() => set_access_app(null)}
        onConnect={(opts) => {
          const app = access_app;
          set_access_app(null);
          if (app) create_connection_mutation.mutate({ app, ...opts });
        }}
      />

      <AlertDialog
        open={connecting_kind === 'api' || connecting_kind === 'website'}
        onOpenChange={(open) => (open ? undefined : set_connecting_kind(null))}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogTitle>Add a custom app</AlertDialogTitle>
          <AlertDialogDescription>
            Connect an app that is not in the catalog. Store its credential once and choose which
            websites it may be sent to.
          </AlertDialogDescription>
          <ConnectAppDialog
            starts_with_sign_in={connecting_kind === 'website'}
            onConnected={() => {
              set_connecting_kind(null);
              refresh_connection_setup_queries();
            }}
          />
        </AlertDialogContent>
      </AlertDialog>

      <AddMcpServerDialog
        open={connecting_kind === 'mcp'}
        on_open_change={(open) => set_connecting_kind(open ? 'mcp' : null)}
        on_added={refresh_connection_setup_queries}
      />
    </main>
  );
}

const CatalogGrid = memo(function CatalogGrid({
  apps,
  popularApps,
  connectionsByApp,
  connectingAppId,
  isError,
  isFetchingNextPage,
  isLoading,
  hasNextPage,
  searchQuery,
  shownCount,
  total,
  websiteFallback,
  onClearSearch,
  onConnect,
  onOpen,
  onLoadMore,
  onRetry,
}: {
  apps: CatalogApp[];
  popularApps: CatalogApp[];
  connectionsByApp: Map<string, Connection[]>;
  connectingAppId: string | null;
  isError: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  hasNextPage: boolean;
  searchQuery: string;
  shownCount: number;
  total: number;
  websiteFallback: React.ReactNode;
  onClearSearch: () => void;
  onConnect: (app: CatalogApp) => void;
  onOpen: (app: CatalogApp) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (isLoading) return <LoadingGrid />;
  if (isError) return <QueryError label="Integrations" onRetry={onRetry} />;
  if (apps.length === 0 && popularApps.length === 0) {
    return (
      <NoAppsToList searchQuery={searchQuery} onClearSearch={onClearSearch}>
        {websiteFallback}
      </NoAppsToList>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {popularApps.length > 0 ? (
        <CatalogSection
          apps={popularApps}
          connectionsByApp={connectionsByApp}
          connectingAppId={connectingAppId}
          title="Popular"
          onConnect={onConnect}
          onOpen={onOpen}
        />
      ) : null}
      <CatalogSection
        apps={apps}
        connectionsByApp={connectionsByApp}
        connectingAppId={connectingAppId}
        title={searchQuery ? 'Search results' : 'More integrations'}
        onConnect={onConnect}
        onOpen={onOpen}
      />
      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isLoading={isFetchingNextPage}
        shownCount={shownCount}
        total={total}
        onLoadMore={onLoadMore}
      />
    </div>
  );
});

const CatalogSection = memo(function CatalogSection({
  apps,
  connectionsByApp,
  connectingAppId,
  title,
  onConnect,
  onOpen,
}: {
  apps: CatalogApp[];
  connectionsByApp: Map<string, Connection[]>;
  connectingAppId: string | null;
  title: string;
  onConnect: (app: CatalogApp) => void;
  onOpen: (app: CatalogApp) => void;
}) {
  if (apps.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase text-muted-foreground">{title}</h2>
      <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <AppRow
            app={app}
            connections={connectionsByApp.get(app.app_id) ?? no_connections}
            isConnecting={connectingAppId === app.app_id}
            key={app.app_id}
            onConnect={onConnect}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
});

function ConnectedGrid({
  connections,
  isError,
  isLoading,
  reconnectingConnectionId,
  revokingConnectionId,
  searchQuery,
  onBrowse,
  onClearSearch,
  onOpenConnection,
  onReconnect,
  onRetry,
  onRevoke,
}: {
  connections: Connection[];
  isError: boolean;
  isLoading: boolean;
  reconnectingConnectionId: string | null;
  revokingConnectionId: string | null;
  searchQuery: string;
  onBrowse: () => void;
  onClearSearch: () => void;
  onOpenConnection: (connection_id: string) => void;
  onReconnect: (connection_id: string) => void;
  onRetry: () => void;
  onRevoke: (connection_id: string) => void;
}) {
  if (isLoading) return <LoadingGrid />;
  if (isError) return <QueryError label="Connected integrations" onRetry={onRetry} />;
  if (connections.length === 0) {
    return (
      <EmptyState
        title={searchQuery ? 'No connected integrations found' : 'No connected integrations yet'}
        actionLabel={searchQuery ? 'Clear search' : 'Browse integrations'}
        onAction={searchQuery ? onClearSearch : onBrowse}
      />
    );
  }

  return (
    <div className="grid gap-y-1">
      {connections.map((connection) => (
        <ConnectionRow
          connection={connection}
          connections={connections}
          isReconnectPending={reconnectingConnectionId === connection.connection_id}
          isRevokePending={revokingConnectionId === connection.connection_id}
          key={connection.connection_id}
          onManage={() => onOpenConnection(connection.connection_id)}
          onOpen={() => onOpenConnection(connection.connection_id)}
          onReconnect={() => onReconnect(connection.connection_id)}
          onRevoke={() => onRevoke(connection.connection_id)}
        />
      ))}
    </div>
  );
}

const AppRow = memo(function AppRow({
  app,
  connections,
  isConnecting,
  onConnect,
  onOpen,
}: {
  app: CatalogApp;
  connections: Connection[];
  isConnecting: boolean;
  onConnect: (app: CatalogApp) => void;
  onOpen: (app: CatalogApp) => void;
}) {
  const open_app = () => onOpen(app);
  const connect_app = () => onConnect(app);
  const profile = first_connection_profile(app);
  const pending_connection = connections.find(
    (connection) => connection.connection_status !== 'revoked',
  );
  const opens_detail = connections.length > 0;

  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_32px] items-center gap-3 rounded-2xl px-2 py-2 hover:bg-hover">
      <button
        type="button"
        className="col-span-2 grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-3 text-left"
        onClick={opens_detail ? open_app : connect_app}
      >
        <AppMark iconUrl={app_icon_url(app)} name={app.app_display_name} />
        <div className="truncate text-sm font-medium">{app.app_display_name}</div>
      </button>
      {opens_detail ? (
        <ActionIconButton
          ariaLabel={`Open ${app.app_display_name}`}
          icon={<ChevronRight className="size-4" aria-hidden="true" />}
          onClick={open_app}
        />
      ) : (
        <ActionIconButton
          ariaLabel={
            pending_connection
              ? `Retry connecting ${app.app_display_name}`
              : `Connect ${app.app_display_name}`
          }
          disabled={!profile || isConnecting}
          isLoading={isConnecting}
          icon={<Plus className="size-4" aria-hidden="true" />}
          onClick={connect_app}
        />
      )}
    </div>
  );
});

export function ConnectionRow({
  connection,
  connections,
  isReconnectPending,
  isRevokePending,
  onManage,
  onOpen,
  onReconnect,
  onRevoke,
  organizationLine,
  siblingAudienceNote,
}: {
  connection: Connection;
  connections: readonly Connection[];
  isReconnectPending: boolean;
  isRevokePending: boolean;
  onManage: () => void;
  onOpen: () => void;
  onReconnect: () => void;
  onRevoke: () => void;
  organizationLine?: React.ReactNode;
  siblingAudienceNote?: React.ReactNode;
}) {
  const app = connection.app;
  const integration_name =
    app?.app_display_name ??
    connection.connection_name ??
    connection.external_account_name ??
    format_label(connection.provider_key ?? 'Connection');
  const detail_label = connection.has_newer_connector
    ? 'Reconnect with the new connector'
    : read_connection_detail(connection, app_description(app));
  const time_label = relative_time(
    date_to_string(connection.connected_time ?? connection.created_time),
  );

  return (
    <div className="min-w-0">
      <div className="relative grid grid-cols-[44px_minmax(0,1fr)_auto_104px] items-center gap-3 rounded-2xl px-2 py-2 hover:bg-hover">
        <button
          type="button"
          className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${integration_name}`}
          onClick={onOpen}
        />
        <div className="pointer-events-none relative">
          <AppMark iconUrl={app ? app_icon_url(app) : undefined} name={integration_name} />
        </div>
        <div className="pointer-events-none relative min-w-0">
          <div className="truncate text-sm font-medium">{integration_name}</div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {detail_label} · {time_label}
          </div>
        </div>
        {organizationLine ?? <ConnectionOrgLine connection={connection} />}
        <div className="pointer-events-none relative z-10 flex justify-end gap-1">
          {connection.permissions.can_manage ? (
            <>
              <ActionIconButton
                ariaLabel={`Manage ${integration_name}`}
                icon={<Settings2 className="size-4" aria-hidden="true" />}
                onClick={onManage}
              />
              {connection.connection_status === 'built_in' ? null : (
                <ActionIconButton
                  ariaLabel={`Reconnect ${integration_name}`}
                  disabled={isReconnectPending}
                  isLoading={isReconnectPending}
                  icon={<RefreshCw className="size-4" aria-hidden="true" />}
                  onClick={onReconnect}
                />
              )}
            </>
          ) : null}
          {connection.permissions.can_delete ? (
            <DisconnectDialog
              connectionName={integration_name}
              disabled={isRevokePending}
              onConfirm={onRevoke}
            />
          ) : null}
        </div>
      </div>
      <ConnectionCannotWorkNote connection={connection} />
      {siblingAudienceNote === undefined ? (
        <SiblingAudienceNote connection={connection} connections={connections} />
      ) : (
        siblingAudienceNote
      )}
    </div>
  );
}

function ActionIconButton({
  ariaLabel,
  disabled,
  icon,
  isLoading,
  onClick,
}: {
  ariaLabel: string;
  disabled?: boolean | undefined;
  icon: React.ReactNode;
  isLoading?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <Button
      className="pointer-events-auto mx-auto rounded-full bg-muted text-muted-foreground hover:bg-hover"
      disabled={disabled}
      size="icon-sm"
      type="button"
      variant="secondary"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
    </Button>
  );
}

function DisconnectDialog({
  connectionName,
  disabled,
  onConfirm,
}: {
  connectionName: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            className="pointer-events-auto rounded-full bg-muted text-muted-foreground hover:bg-hover"
            disabled={disabled}
            size="icon-sm"
            type="button"
            variant="secondary"
            aria-label={`Disconnect ${connectionName}`}
          >
            {disabled ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Unplug className="size-4" aria-hidden="true" />
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {connectionName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Tools that use this account will stop working until the integration is reconnected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LoadMoreFooter({
  hasNextPage,
  isLoading,
  shownCount,
  total,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isLoading: boolean;
  shownCount: number;
  total: number;
  onLoadMore: () => void;
}) {
  const load_more_marker = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const marker = load_more_marker.current;
    if (!marker || !hasNextPage || isLoading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, onLoadMore]);

  return (
    <div ref={load_more_marker} className="flex min-h-8 items-center justify-center gap-2 pt-1">
      <div className="text-xs text-muted-foreground tabular-nums">
        Showing {shownCount.toLocaleString()} of {total.toLocaleString()}
      </div>
      {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
    </div>
  );
}

function ConnectionSetupCallout({ notice }: { notice: ConnectionSetupNotice }) {
  return (
    <div
      className={cn(
        'mt-5 rounded-2xl border px-4 py-3 text-sm',
        notice.tone === 'error' && 'border-destructive/30 text-destructive',
        notice.tone === 'warning' && 'border-caution text-caution-ink',
        notice.tone === 'success' && 'border-primary/30 text-foreground',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{notice.title}</div>
          <div className="mt-1 text-xs text-muted-foreground text-pretty">{notice.description}</div>
        </div>
        {notice.action_url ? (
          <a
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            href={notice.action_url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open
          </a>
        ) : null}
      </div>
    </div>
  );
}

function AppMark({ name, iconUrl }: { name: string; iconUrl?: string | undefined }) {
  return (
    <div className="plate size-10 text-xs font-medium">
      {iconUrl ? (
        <span
          className="size-full bg-contain bg-center bg-no-repeat p-1"
          style={{ backgroundImage: `url("${iconUrl}")` }}
          aria-hidden="true"
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-4 text-sm text-destructive">
      <span>{label} unavailable.</span>
      <Button size="sm" type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-x-12 gap-y-2 md:grid-cols-2">
      {loading_row_keys.map((key) => (
        <div
          className="grid grid-cols-[44px_minmax(0,1fr)_32px] items-center gap-3 px-2 py-2"
          key={key}
        >
          <Skeleton className="size-10 rounded-3xl" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-60 max-w-full" />
          </div>
          <Skeleton className="size-8 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function group_connections_by_app(connections: Connection[]) {
  const grouped = new Map<string, Connection[]>();
  for (const connection of connections) {
    grouped.set(connection.app_id, [...(grouped.get(connection.app_id) ?? []), connection]);
  }
  return grouped;
}

function order_apps_by_keys(apps: CatalogApp[], keys: readonly string[]) {
  return keys.flatMap((key) => {
    const app = apps.find((candidate) => app_matches_alias(candidate, key));
    return app ? [app] : [];
  });
}

function live_connections(connections: Connection[]) {
  return connections.filter((connection) => connection.connection_status !== 'revoked');
}

function connected_connections(connections: Connection[]) {
  return connections.filter((connection) => connection.connection_status !== 'pending_setup');
}

function filter_connections(connections: Connection[], query: string) {
  const normalized_query = normalize_search(query);
  if (!normalized_query) return connections;

  return connections.filter((connection) =>
    connection_search_text(connection).includes(normalized_query),
  );
}

function connection_search_text(connection: Connection) {
  const app = connection.app;
  return normalize_search(
    [
      app?.app_display_name,
      app?.app_name,
      app?.app_category,
      app_description(app),
      connection.connection_name,
      connection.external_account_name,
      connection.external_account_id,
      connection.provider_key,
      connection.provider_config_key,
      connection.connection_profile_key,
      connection.connection_status,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function first_connection_profile(app: { metadata: unknown }): ConnectionProfile | null {
  const metadata = app.metadata as AppCatalogMetadata;
  const provider_configs = metadata.provider_configs ?? [];

  for (const config of provider_configs) {
    if (config.status !== 'active') continue;
    const profile = config.connection_profiles.find((candidate) => candidate.status === 'active');
    if (!profile) continue;

    const provider_key = config.provider_key;
    const provider_config_key = config.provider_config_key;
    const connection_profile_key = profile.connection_profile_key;

    return {
      ...(provider_key ? { provider_key } : {}),
      ...(provider_config_key ? { provider_config_key } : {}),
      ...(connection_profile_key ? { connection_profile_key } : {}),
    };
  }

  return null;
}

function app_description(app: AppDisplaySource | null | undefined) {
  if (!app) return null;
  const metadata = app.metadata as AppCatalogMetadata;
  const display_config = app.display_config as Pick<AppCatalogMetadata, 'description'>;
  return metadata.description ?? display_config.description ?? null;
}

function app_icon_url(app: AppDisplaySource | null | undefined) {
  if (!app) return undefined;
  const metadata = app.metadata as AppCatalogMetadata;
  const display_config = app.display_config as Pick<AppCatalogMetadata, 'icon_url'>;
  return metadata.icon_url ?? display_config.icon_url;
}

function show_connection_setup_result(
  result: ConnectionSetupResult,
  title: string,
  set_notice: (notice: ConnectionSetupNotice) => void,
) {
  if (!result.start_url) {
    set_notice({
      tone: 'error',
      title: 'Connection setup failed',
      description: result.setup.setup_error ?? 'Setup did not produce a link to finish this.',
    });
    toast.error(result.setup.setup_error ?? 'Connection setup failed');
    return;
  }

  set_notice({
    tone: 'success',
    title,
    description: connection_setup_description(result.setup),
    action_url: result.start_url,
  });
}

function show_connection_setup_error(
  error: unknown,
  title: string,
  set_notice: (notice: ConnectionSetupNotice) => void,
) {
  set_notice({
    tone: 'error',
    title,
    description: format_error_message(error, 'The request failed.'),
  });
}

function open_connection_setup(start_url: string | null) {
  if (start_url) window.open(start_url, '_blank', 'noopener,noreferrer');
}

function connection_setup_description(setup: ConnectionSetupState) {
  if (setup.setup_error) return setup.setup_error;
  if (setup.type === 'manual') return 'Manual setup is ready for this connection.';
  return 'Setup is ready. Finish it in the tab that just opened.';
}

function date_to_string(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalize_search(value: string) {
  return value.trim().toLowerCase();
}

function format_label(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
