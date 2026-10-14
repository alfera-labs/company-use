import { Button } from '@coworker/ui/components/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type AiProvider,
  read_suggested_provider,
} from '@/components/install_sign_in/ai_providers';
import { GetKeyLink } from '@/components/install_sign_in/paste_key_form';
import {
  InstallKeyRefused,
  install_ai_keys_query_key,
  save_install_ai_key,
} from '@/lib/api/install_ai_keys';
import { query_keys } from '@/lib/api/query_keys';

function useSaveProviderKey(provider: AiProvider, on_saved: () => void) {
  const query_client = useQueryClient();
  const [api_key, set_api_key] = useState('');
  const save = useMutation({
    mutationFn: () =>
      save_install_ai_key({ api_key: api_key.trim(), provider_slot: provider.provider_slot }),
    onSuccess: async (key) => {
      await query_client.invalidateQueries({ queryKey: install_ai_keys_query_key });
      await query_client.invalidateQueries({ queryKey: query_keys.models() });
      toast.success(`${key.display_name} key saved`);
      on_saved();
    },
  });
  const sends_after_switch = useRef(false);
  useEffect(() => {
    if (!sends_after_switch.current) return;
    sends_after_switch.current = false;
    save.mutate();
  });
  const suggested =
    save.error instanceof InstallKeyRefused
      ? read_suggested_provider(save.error.code, save.error.details)
      : null;
  const change_key = (value: string) => {
    set_api_key(value);
    if (save.error) save.reset();
  };
  const switch_and_send = (on_switch: () => void) => {
    sends_after_switch.current = true;
    save.reset();
    on_switch();
  };
  return { api_key, change_key, save, suggested, switch_and_send };
}

function KeyRefusal({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

function KeyField({
  provider,
  value,
  on_change,
}: {
  provider: AiProvider;
  value: string;
  on_change: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">Your {provider.name} API key</span>
      <input
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder={provider.key_placeholder}
        onChange={(event) => on_change(event.target.value)}
        className="h-11 rounded-xl bg-muted px-3.5 font-mono text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-border"
      />
    </label>
  );
}

/** Step two of adding a key in Settings: the key of the provider the person chose. */
export function PasteInstallKey({
  provider,
  on_saved,
  on_back,
  on_use_provider,
}: {
  provider: AiProvider;
  on_saved: () => void;
  on_back: () => void;
  on_use_provider: (provider_slot: string) => void;
}) {
  const form = useSaveProviderKey(provider, on_saved);
  const { suggested } = form;
  return (
    <form
      method="post"
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.api_key.trim()) form.save.mutate();
      }}
    >
      <KeyField provider={provider} value={form.api_key} on_change={form.change_key} />
      <GetKeyLink provider={provider} className="flex w-fit text-sm" />
      <KeyRefusal message={form.save.error?.message} />
      <div className="flex gap-2">
        {suggested ? (
          <Button
            type="button"
            size="sm"
            onClick={() => form.switch_and_send(() => on_use_provider(suggested.provider_slot))}
          >
            Use {suggested.name} instead
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!form.api_key.trim() || form.save.isPending}>
            {form.save.isPending ? `Checking with ${provider.name}…` : 'Check and save'}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={on_back}>
          Back
        </Button>
      </div>
    </form>
  );
}
