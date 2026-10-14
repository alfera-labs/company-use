import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { ConnectionAudienceReadback } from '@/components/connections/connection_audience_field';
import { ConnectionDetailActions } from '@/components/connections/connection_detail_actions';
import {
  read_connection_page_names,
  read_mcp_server_address,
} from '@/components/connections/connection_page_names';
import { ConnectionSettings } from '@/components/connections/connection_settings';
import {
  ConnectionCannotWorkNote,
  ConnectionStatusBadge,
  read_connection_status_label,
} from '@/components/connections/connection_status';
import { ConnectionToolManagement } from '@/components/connections/connection_tool_management';
import { get_connection } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { CatalogApp, Connection } from '@/lib/api/types';
import { app_icon_url } from '@/lib/catalog_app';

export function ConnectionDetailPage({ connection_id }: { connection_id: string }) {
  const query = useQuery({
    queryKey: query_keys.connection(connection_id),
    queryFn: () => get_connection(connection_id),
  });
  if (query.isPending) return <ConnectionDetailSkeleton />;
  if (query.isError)
    return (
      <ConnectionDetailError message={query.error.message} onRetry={() => void query.refetch()} />
    );

  const connection = query.data;
  return (
    <main className="mx-auto w-full max-w-6xl pb-12">
      <ConnectionHeader connection={connection} />
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ConnectionToolManagement
          connection_id={connection.connection_id}
          read_only={!connection.permissions.can_manage}
        />
        <aside className="grid gap-5">
          <ConnectionOverview connection={connection} />
          {connection.permissions.can_manage && connection.connection_status !== 'built_in' ? (
            <ConnectionSettings connection={connection} />
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function ConnectionHeader({ connection }: { connection: Connection }) {
  const app = connection.app as CatalogApp | null;
  const names = read_connection_page_names(connection);
  return (
    <header>
      <nav
        className="flex items-center gap-1 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link to="/integrations" className="hover:text-foreground">
          Integrations
        </Link>
        {names.breadcrumb.map((name) => (
          <Fragment key={name}>
            <ChevronRight className="size-4" aria-hidden="true" />
            <span className="truncate">{name}</span>
          </Fragment>
        ))}
      </nav>
      <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <AppMark app={app} name={names.app_name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">{names.title}</h1>
              <ConnectionStatusBadge connection={connection} />
            </div>
            {names.under_the_title ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">{names.under_the_title}</p>
            ) : null}
            <ConnectionCannotWorkNote
              connection={connection}
              className="mt-2 max-w-xl text-sm text-muted-foreground"
            />
          </div>
        </div>
        <ConnectionDetailActions connection={connection} />
      </div>
    </header>
  );
}

function ConnectionOverview({ connection }: { connection: Connection }) {
  const server_address = read_mcp_server_address(connection);
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold">Connection details</h2>
      <dl className="mt-4 divide-y divide-border text-sm">
        {connection.external_account_name ? (
          <DetailRow label="Account" value={connection.external_account_name} />
        ) : null}
        {server_address ? <DetailRow label="Server" value={server_address} /> : null}
        <DetailRow label="Status" value={read_connection_status_label(connection)} />
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Access</dt>
          <dd className="text-right font-medium">
            <ConnectionAudienceReadback connection={connection} />
          </dd>
        </div>
        <DetailRow
          label="Connected"
          value={format_date(connection.connected_time ?? connection.created_time)}
        />
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[180px] truncate text-right font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

function AppMark({ app, name }: { app: CatalogApp | null; name: string }) {
  const icon_url = app ? app_icon_url(app) : undefined;
  return (
    <div className="plate size-14 shrink-0 text-base font-semibold">
      {icon_url ? (
        <span
          className="size-full bg-contain bg-center bg-no-repeat p-1"
          style={{ backgroundImage: `url("${icon_url}")` }}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function ConnectionDetailSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <Skeleton className="h-24" />
      <Skeleton className="h-[580px]" />
    </div>
  );
}

function ConnectionDetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="text-xl font-semibold">The connection could not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button className="mt-5" type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function format_date(value: string | Date | null | undefined) {
  if (!value) return 'Not reported';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
