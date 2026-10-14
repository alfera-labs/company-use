import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type ApiKeyProvider, api_key_providers } from '@/components/app/ai_account_rows';
import {
  is_plan_required_error,
  OwnAiPlanRequiredLine,
} from '@/components/app/own_ai_plan_required';
import { useConnectAiAccount } from '@/components/app/use_ai_accounts';

export function ApiKeyForm({ on_connected }: { on_connected: () => void }) {
  const [provider, set_provider] = useState<ApiKeyProvider>(api_key_providers[0] as ApiKeyProvider);
  const [api_key, set_api_key] = useState('');
  const connect = useConnectAiAccount(provider.slot);

  return (
    <ApiKeyFormView
      provider={provider}
      api_key={api_key}
      on_change={set_api_key}
      on_provider_change={(candidate) => {
        set_provider(candidate);
        connect.reset();
      }}
      submitting={connect.isPending}
      error={
        is_plan_required_error(connect.error) ? <OwnAiPlanRequiredLine /> : connect.error?.message
      }
      on_submit={() => {
        if (api_key.trim()) connect.mutate(api_key.trim(), { onSuccess: on_connected });
      }}
    />
  );
}

export function ApiKeyFormView({
  provider,
  api_key,
  on_change,
  on_provider_change,
  on_submit,
  submitting = false,
  error,
  read_only = false,
}: {
  provider: ApiKeyProvider;
  api_key: string;
  on_change: (value: string) => void;
  on_provider_change: (provider: ApiKeyProvider) => void;
  on_submit: () => void;
  submitting?: boolean;
  error?: ReactNode;
  read_only?: boolean;
}) {
  return (
    <form
      className="mt-4 ps-[2rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!read_only) on_submit();
      }}
    >
      <ProviderRail selected={provider} on_select={on_provider_change} />
      <ApiKeyField
        provider={provider}
        api_key={api_key}
        on_change={on_change}
        submitting={submitting}
        read_only={read_only}
      />
      <p className={cn('mt-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error ?? `Checked with ${provider.label} before it is saved.`}
      </p>
    </form>
  );
}

function ProviderRail({
  selected,
  on_select,
}: {
  selected: ApiKeyProvider;
  on_select: (provider: ApiKeyProvider) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {api_key_providers.map((candidate) => (
        <button
          key={candidate.slot}
          type="button"
          aria-pressed={candidate.slot === selected.slot}
          onClick={() => on_select(candidate)}
          className={cn(
            'flex w-[4.5rem] flex-col items-center gap-1.5 rounded-2xl py-2.5 text-xs transition-colors motion-reduce:transition-none',
            candidate.slot === selected.slot
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted/60',
          )}
        >
          <img
            src={candidate.logo}
            alt=""
            width={22}
            height={22}
            className="size-[22px] object-contain dark:invert-[0.9]"
          />
          {candidate.label}
        </button>
      ))}
    </div>
  );
}

function ApiKeyField({
  provider,
  api_key,
  on_change,
  submitting,
  read_only = false,
}: {
  provider: ApiKeyProvider;
  api_key: string;
  on_change: (value: string) => void;
  submitting: boolean;
  read_only?: boolean;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!read_only) field.current?.focus();
  }, [read_only]);

  return (
    <div className="mt-3 flex h-12 items-center gap-2 rounded-xl bg-muted ps-3.5 pe-1 focus-within:ring-1 focus-within:ring-border">
      <input
        // Not `type="password"`: a browser offers to save whatever sits in one, and a provider key
        // filed away as a website login is a mess to undo later.
        ref={field}
        value={api_key}
        readOnly={read_only}
        spellCheck={false}
        autoComplete="off"
        placeholder={provider.placeholder}
        aria-label={`${provider.label} API key`}
        onChange={(event) => on_change(event.target.value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="font-medium"
        disabled={!api_key.trim() || submitting || read_only}
      >
        {submitting ? 'Checking…' : 'Connect'}
      </Button>
    </div>
  );
}
