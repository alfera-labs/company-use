import { public_api_docs_url } from '@coworker/config/hosted_defaults';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@coworker/ui/components/card';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { ApiKeyRow } from '@/components/app/api_key_row';
import { CreateApiKeyDialog } from '@/components/app/create_api_key_dialog';
import { list_api_keys } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';
import type { ApiKey } from '@/lib/api/types';

export function ApiKeySettings() {
  const keys_query = useQuery({ queryKey: query_keys.api_keys(), queryFn: list_api_keys });
  const [creating, set_creating] = useState(false);
  const keys = keys_query.data ?? [];
  const is_not_admin = keys_query.error instanceof ApiError && keys_query.error.status === 403;
  const open_create = () => set_creating(true);

  return (
    <Card id="api-keys">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-base">API &amp; MCP</CardTitle>
            <CardDescription>
              A key lets your own code or an AI assistant like Claude use this workspace.
            </CardDescription>
          </div>
          {keys.length > 0 ? (
            <Button size="sm" variant="outline" onClick={open_create}>
              Create key
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {keys_query.isLoading ? (
          <LoadingKeys />
        ) : is_not_admin ? (
          <AskAnAdmin />
        ) : keys_query.error ? (
          <KeysUnavailable
            message={keys_query.error.message}
            on_retry={() => void keys_query.refetch()}
          />
        ) : keys.length === 0 ? (
          <NoKeysYet on_create={open_create} />
        ) : (
          <KeyList keys={keys} />
        )}
      </CardContent>
      <CreateApiKeyDialog open={creating} on_open_change={set_creating} />
    </Card>
  );
}

function KeyList({ keys }: { keys: ApiKey[] }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="w-full overflow-hidden rounded-2xl border border-border">
        <div className="divide-y divide-border">
          {keys.map((api_key) => (
            <ApiKeyRow key={api_key.api_key_id} api_key={api_key} />
          ))}
        </div>
      </div>
      <ReadTheDocs />
    </div>
  );
}

function NoKeysYet({ on_create }: { on_create: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed px-4 py-6">
      <p className="text-sm text-muted-foreground">
        One key works for the API and for MCP. You see it once, right after you create it, and you
        can turn it off at any time.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={on_create}>
          Create key
        </Button>
        <ReadTheDocs />
      </div>
    </div>
  );
}

function AskAnAdmin() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed px-4 py-6">
      <p className="text-sm text-muted-foreground">
        Ask a workspace admin to create a key. A key works for the whole workspace, so only admins
        can make one.
      </p>
      <ReadTheDocs />
    </div>
  );
}

function ReadTheDocs() {
  return (
    <a
      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      href={public_api_docs_url}
      rel="noreferrer"
      target="_blank"
    >
      Read the docs
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}

function LoadingKeys() {
  return (
    <div className="flex flex-col gap-2">
      {loading_rows.map((row) => (
        <Skeleton key={row} className="h-16 rounded-2xl" />
      ))}
    </div>
  );
}

function KeysUnavailable({ message, on_retry }: { message: string; on_retry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed p-4">
      <p className="text-sm text-muted-foreground">{message || 'API keys could not be loaded.'}</p>
      <Button size="sm" variant="outline" onClick={on_retry}>
        <RefreshCw />
        Retry
      </Button>
    </div>
  );
}

const loading_rows = ['one', 'two'];
