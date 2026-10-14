import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AddInstallAiKey } from '@/components/app/add_install_ai_key';
import { AccountsUnavailable } from '@/components/app/ai_account_row';
import { WorkspaceKeyOverrides } from '@/components/app/workspace_key_overrides';
import {
  type InstallAiKey,
  install_ai_keys_query_key,
  list_install_ai_keys,
  remove_install_ai_key,
} from '@/lib/api/install_ai_keys';
import { query_keys } from '@/lib/api/query_keys';

function useInstallAiKeyChanges() {
  const query_client = useQueryClient();
  const refresh = async () => {
    await query_client.invalidateQueries({ queryKey: install_ai_keys_query_key });
    await query_client.invalidateQueries({ queryKey: query_keys.models() });
  };
  const remove = useMutation({
    mutationFn: (key: InstallAiKey) => remove_install_ai_key(key.provider_slot),
    onSuccess: async (_, key) => {
      await refresh();
      toast.success(`${key.display_name} key removed`);
    },
    onError: (error) => toast.error(format_error_message(error, 'The key was not removed')),
  });
  return { remove };
}

function SavedKeyRow({
  ai_key,
  removing,
  on_remove,
}: {
  ai_key: InstallAiKey;
  removing: boolean;
  on_remove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-border border-t py-3.5">
      <p className="text-sm">
        {ai_key.display_name}
        <span className="text-muted-foreground">
          {ai_key.provider_slot === 'chatgpt_plan'
            ? ' plan, signed in'
            : ` key ending in ${ai_key.secret_hint}`}
        </span>
      </p>
      <Button
        size="sm"
        variant="ghost"
        disabled={removing}
        aria-label={`Remove the ${ai_key.display_name} key`}
        onClick={on_remove}
      >
        Remove
      </Button>
    </div>
  );
}

export function InstallAiKeySettings() {
  const keys_query = useQuery({
    queryKey: install_ai_keys_query_key,
    queryFn: list_install_ai_keys,
  });
  const { remove } = useInstallAiKeyChanges();
  if (keys_query.isLoading) return <Skeleton className="h-28 rounded-2xl" />;
  if (keys_query.error || !keys_query.data) {
    return (
      <AccountsUnavailable
        message={keys_query.error?.message ?? ''}
        on_retry={() => void keys_query.refetch()}
      />
    );
  }
  return (
    <div>
      <h2 className="mb-1 font-medium text-foreground text-sm">AI keys of this server</h2>
      <p className="mb-3 text-muted-foreground text-sm">
        Every workspace on this server uses these keys.
      </p>
      {keys_query.data.map((ai_key) => (
        <SavedKeyRow
          key={ai_key.provider_slot}
          ai_key={ai_key}
          removing={remove.isPending}
          on_remove={() => remove.mutate(ai_key)}
        />
      ))}
      <AddInstallAiKey has_keys={keys_query.data.length > 0} />
      <WorkspaceKeyOverrides />
    </div>
  );
}
