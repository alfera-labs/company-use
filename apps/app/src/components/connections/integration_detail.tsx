import { Button, buttonVariants } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { count_connected_accounts } from '@/components/connections/connected_accounts';
import { ConnectionAudienceReadback } from '@/components/connections/connection_audience_field';
import type { Connection, IntegrationApp } from '@/lib/api/types';

export function IntegrationDetail({
  app,
  connections,
  description,
  iconUrl,
  onAddAccount,
  onBack,
}: {
  app: IntegrationApp;
  connections: Connection[];
  description: string;
  iconUrl?: string | undefined;
  onAddAccount: () => void;
  onBack: () => void;
}) {
  const [search_query, set_search_query] = useState('');
  const visible_connections = useMemo(
    () => filter_accounts(connections, search_query),
    [connections, search_query],
  );

  return (
    <>
      <IntegrationHeader
        app={app}
        description={description}
        iconUrl={iconUrl}
        onAddAccount={onAddAccount}
        onBack={onBack}
      />
      <AccountList
        connections={visible_connections}
        searchQuery={search_query}
        total={count_connected_accounts(connections)}
        onSearchChange={set_search_query}
      />
    </>
  );
}

function IntegrationHeader({
  app,
  description,
  iconUrl,
  onAddAccount,
  onBack,
}: {
  app: IntegrationApp;
  description: string;
  iconUrl?: string | undefined;
  onAddAccount: () => void;
  onBack: () => void;
}) {
  return (
    <header>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <button type="button" className="hover:text-foreground" onClick={onBack}>
          Integrations
        </button>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span className="text-foreground">{app.app_display_name}</span>
      </div>
      <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <IntegrationIcon iconUrl={iconUrl} name={app.app_display_name} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{app.app_display_name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button className="shrink-0" type="button" onClick={onAddAccount}>
          <Plus className="size-4" aria-hidden="true" />
          Add account
        </Button>
      </div>
    </header>
  );
}

function AccountList({
  connections,
  searchQuery,
  total,
  onSearchChange,
}: {
  connections: Connection[];
  searchQuery: string;
  total: number;
  onSearchChange: (value: string) => void;
}) {
  return (
    <section className="mt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'account' : 'accounts'} connected
          </p>
        </div>
        <AccountSearch value={searchQuery} onChange={onSearchChange} />
      </div>
      <AccountTable connections={connections} />
    </section>
  );
}

function AccountSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full sm:w-72">
      <label className="sr-only" htmlFor="account-search">
        Search connected accounts
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="account-search"
        className="h-9 pl-9"
        placeholder="Search accounts"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function AccountTable({ connections }: { connections: Connection[] }) {
  if (connections.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No connected accounts match this search.
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[640px] table-fixed text-left text-sm">
        <thead className="border-b border-border bg-sunken text-xs text-muted-foreground">
          <tr>
            <th className="w-[42%] px-4 py-3 font-medium">Account</th>
            <th className="w-[30%] px-4 py-3 font-medium">Access</th>
            <th className="w-[16%] px-4 py-3 font-medium">Status</th>
            <th className="w-[12%] px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {connections.map((connection) => (
            <AccountRow connection={connection} key={connection.connection_id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({ connection }: { connection: Connection }) {
  const account_name = connection.connection_name ?? connection.external_account_name ?? 'Account';
  const account_detail = connection.external_account_name;

  return (
    <tr>
      <td className="px-4 py-3">
        <Link
          to="/integrations/$connection_id"
          params={{ connection_id: connection.connection_id }}
          className="truncate font-medium hover:underline"
        >
          {account_name}
        </Link>
        {account_detail && account_detail !== account_name ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{account_detail}</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <span className="text-muted-foreground">
          <ConnectionAudienceReadback connection={connection} />
        </span>
      </td>
      <td className="px-4 py-3">
        <ConnectionStatus connection={connection} />
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to="/integrations/$connection_id"
          params={{ connection_id: connection.connection_id }}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Open
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  const active = connection.connection_status === 'active';
  return (
    <span className="inline-flex items-center gap-2 capitalize text-muted-foreground">
      <span
        className={active ? 'size-2 rounded-full bg-positive' : 'size-2 rounded-full bg-caution'}
      />
      {connection.connection_status.replaceAll('_', ' ')}
    </span>
  );
}

function IntegrationIcon({ iconUrl, name }: { iconUrl?: string | undefined; name: string }) {
  return (
    <div className="plate size-12 text-sm font-medium">
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

function filter_accounts(connections: Connection[], search_query: string) {
  const query = search_query.trim().toLowerCase();
  if (!query) return connections;
  return connections.filter((connection) =>
    [connection.connection_name, connection.external_account_name]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query)),
  );
}
