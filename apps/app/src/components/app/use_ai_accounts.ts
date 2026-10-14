import { format_error_message } from '@coworker/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type AiAccountsOverview,
  connect_model_provider_account,
  disconnect_model_provider_account,
  list_model_provider_accounts,
  type ModelBillingSource,
  type ModelProviderAccount,
  type ModelProviderSlot,
  set_model_billing_source,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function useAiAccounts() {
  return useQuery({
    queryKey: query_keys.model_provider_accounts(),
    queryFn: list_model_provider_accounts,
  });
}

export function useConnectAiAccount(provider_slot: ModelProviderSlot) {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (api_key: string) => connect_model_provider_account({ provider_slot, api_key }),
    onSuccess: async (account) => {
      write_account(query_client, account);
      await query_client.invalidateQueries({ queryKey: query_keys.model_provider_accounts() });
      toast.success(`${account.display_name} connected`);
    },
  });
}

export function useDisconnectAiAccount(provider_slot: ModelProviderSlot, provider_label: string) {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: () => disconnect_model_provider_account(provider_slot),
    onSuccess: async () => {
      query_client.setQueryData<AiAccountsOverview>(
        query_keys.model_provider_accounts(),
        (overview) =>
          overview
            ? {
                ...overview,
                accounts: overview.accounts.filter(
                  (account) => account.provider_slot !== provider_slot,
                ),
              }
            : overview,
      );
      await query_client.invalidateQueries({ queryKey: query_keys.model_provider_accounts() });
      toast.success(`${provider_label} disconnected`);
    },
    onError: (error) => toast.error(format_error_message(error, 'Disconnect failed')),
  });
}

export function useSetBillingSource() {
  const query_client = useQueryClient();

  return useMutation({
    mutationFn: (source: ModelBillingSource) => set_model_billing_source(source),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.model_provider_accounts() });
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not switch billing')),
  });
}

export function write_account(query_client: QueryClient, account: ModelProviderAccount) {
  query_client.setQueryData<AiAccountsOverview>(query_keys.model_provider_accounts(), (overview) =>
    overview
      ? {
          ...overview,
          accounts: [
            ...overview.accounts.filter(
              (existing) => existing.provider_slot !== account.provider_slot,
            ),
            account,
          ],
        }
      : overview,
  );
}
