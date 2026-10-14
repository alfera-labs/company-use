import { Button } from '@coworker/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { useAiAccounts, useDisconnectAiAccount } from '@/components/app/use_ai_accounts';
import type { ModelProviderAccount } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

function OverrideRow({ account }: { account: ModelProviderAccount }) {
  const query_client = useQueryClient();
  const disconnect = useDisconnectAiAccount(
    account.provider_slot,
    `The ${account.display_name} key of this workspace is`,
  );
  return (
    <div className="flex items-center justify-between gap-3 border-border border-t py-3.5">
      <p className="text-sm">
        {account.display_name}
        <span className="text-muted-foreground">
          : this workspace uses its own key, not the key of the server.
        </span>
      </p>
      <Button
        size="sm"
        variant="ghost"
        disabled={disconnect.isPending}
        aria-label={`Remove the ${account.display_name} key of this workspace`}
        onClick={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => void query_client.invalidateQueries({ queryKey: query_keys.models() }),
          })
        }
      >
        Use the server key
      </Button>
    </div>
  );
}

/** The keys this workspace saved for itself. Each one wins over the key of the server. */
export function WorkspaceKeyOverrides() {
  const accounts_query = useAiAccounts();
  if (accounts_query.error) {
    return (
      <p className="mt-5 text-muted-foreground text-sm">
        Alfera could not check for keys of this workspace only.{' '}
        <button type="button" className="underline" onClick={() => void accounts_query.refetch()}>
          Try again
        </button>
      </p>
    );
  }
  const accounts = (accounts_query.data?.accounts ?? []).filter(
    (account) => account.credential_status === 'active',
  );
  if (accounts.length === 0) return null;
  return (
    <div className="mt-5">
      <h2 className="mb-1 font-medium text-foreground text-sm">Keys of this workspace only</h2>
      {accounts.map((account) => (
        <OverrideRow key={account.provider_slot} account={account} />
      ))}
    </div>
  );
}
