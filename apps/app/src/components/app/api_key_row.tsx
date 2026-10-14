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
} from '@coworker/ui/components/alert-dialog';
import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { ApiKeyMemoryMenu } from '@/components/app/api_key_memory_menu';
import {
  api_key_audience_choices,
  api_key_scope_descriptions,
} from '@/components/app/api_key_scopes';
import { relative_time, revoke_api_key } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { ApiKey } from '@/lib/api/types';

export function ApiKeyRow({ api_key }: { api_key: ApiKey }) {
  const query_client = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => revoke_api_key(api_key.api_key_id),
    onSuccess: async (revoked) => {
      query_client.setQueryData<ApiKey[]>(query_keys.api_keys(), (keys) =>
        keys?.map((key) => (key.api_key_id === revoked.api_key_id ? revoked : key)),
      );
      await query_client.invalidateQueries({ queryKey: query_keys.api_keys() });
      toast.success(`${revoked.key_name} revoked`);
    },
    onError: (error) => toast.error(format_error_message(error, 'Revoke failed')),
  });

  return (
    <ApiKeyRowView
      api_key={api_key}
      is_revoke_pending={revoke.isPending}
      on_revoke={() => revoke.mutate()}
      actions={<ApiKeyMemoryMenu api_key={api_key} />}
    />
  );
}

export function ApiKeyRowView({
  api_key,
  is_revoke_pending = false,
  on_revoke,
  actions,
}: {
  api_key: ApiKey;
  is_revoke_pending?: boolean;
  on_revoke?: () => void;
  actions?: ReactNode;
}) {
  const [confirming_revoke, set_confirming_revoke] = useState(false);
  const is_active = api_key.key_status === 'active';
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm ${
        is_active ? '' : 'opacity-60'
      }`}
    >
      <div className="min-w-64 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{api_key.key_name}</p>
          <code className="rounded-2xl border bg-muted px-1.5 py-0.5 text-xs">
            {api_key.key_prefix}…
          </code>
        </div>
        <ScopeBadges scopes={api_key.scopes} />
        <p className="text-xs text-muted-foreground">
          Last used {relative_time(api_key.last_used_time)} · created{' '}
          <span title={new Date(api_key.created_time).toLocaleString()}>
            {relative_time(api_key.created_time)}
          </span>
        </p>
      </div>
      <Badge variant="outline">{api_key_audience_choices[api_key.key_audience].label}</Badge>
      <Badge variant={api_key.key_status === 'revoked' ? 'destructive' : 'secondary'}>
        {status_labels[api_key.key_status]}
      </Badge>
      {is_active ? actions : null}
      {is_active ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={is_revoke_pending}
          onClick={() => set_confirming_revoke(true)}
        >
          Revoke
        </Button>
      ) : null}
      <RevokeKeyDialog
        key_name={api_key.key_name}
        open={confirming_revoke}
        on_open_change={set_confirming_revoke}
        on_revoke={on_revoke}
      />
    </div>
  );
}

function RevokeKeyDialog({
  key_name,
  open,
  on_open_change,
  on_revoke,
}: {
  key_name: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_revoke: (() => void) | undefined;
}) {
  return (
    <AlertDialog open={open} onOpenChange={on_open_change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {key_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Requests with this key stop working immediately. This cannot be undone — anything still
            using it needs a new key.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep key</AlertDialogCancel>
          <AlertDialogAction onClick={on_revoke}>Revoke key</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ScopeBadges({ scopes }: { scopes: ApiKey['scopes'] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => (
        <Badge
          key={scope}
          variant="secondary"
          className="font-normal"
          title={api_key_scope_descriptions[scope]}
        >
          {scope}
        </Badge>
      ))}
    </div>
  );
}

const status_labels: Record<ApiKey['key_status'], string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};
