import { AlertDialog, AlertDialogContent } from '@coworker/ui/components/alert-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api_key_access_choices } from '@/components/app/api_key_scopes';
import {
  type ApiKeyDraft,
  CreateApiKeyForm,
  empty_api_key_draft,
} from '@/components/app/create_api_key_form';
import { MintedApiKeySecret } from '@/components/app/minted_api_key_secret';
import { create_api_key } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { ApiKey, MintedApiKey } from '@/lib/api/types';

export function CreateApiKeyDialog({
  open,
  on_open_change,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
}) {
  const [draft, set_draft] = useState<ApiKeyDraft>(empty_api_key_draft);
  const [minted, set_minted] = useState<MintedApiKey | null>(null);
  const create = useCreateApiKey(draft, set_minted);

  function close_dialog() {
    on_open_change(false);
    set_minted(null);
    set_draft(empty_api_key_draft);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => (next ? on_open_change(true) : close_dialog())}
    >
      <AlertDialogContent className="max-w-lg">
        {minted ? (
          <MintedApiKeySecret minted={minted} on_done={close_dialog} />
        ) : (
          <CreateApiKeyForm
            draft={draft}
            pending={create.isPending}
            on_change={set_draft}
            on_cancel={close_dialog}
            on_submit={() => create.mutate()}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useCreateApiKey(draft: ApiKeyDraft, on_minted: (minted: MintedApiKey) => void) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const { scopes, key_audience } = api_key_access_choices[draft.access];
      return create_api_key({ key_name: draft.key_name.trim(), scopes: [...scopes], key_audience });
    },
    onSuccess: async (result) => {
      on_minted(result);
      query_client.setQueryData<ApiKey[]>(query_keys.api_keys(), (keys) => [
        result.api_key,
        ...(keys ?? []),
      ]);
      await query_client.invalidateQueries({ queryKey: query_keys.api_keys() });
      await query_client.invalidateQueries({ queryKey: query_keys.connections() });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Could not create the key'),
  });
}
