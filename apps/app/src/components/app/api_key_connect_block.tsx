import { Button } from '@coworker/ui/components/button';
import { useState } from 'react';
import { AiAccountRow, ConnectedDetail, DisconnectDialog } from '@/components/app/ai_account_row';
import {
  credential_state,
  find_api_key_provider,
  masked_secret_hint,
} from '@/components/app/ai_account_rows';
import { ApiKeyForm } from '@/components/app/api_key_form';
import { PlansLinkButton } from '@/components/app/own_ai_plan_required';
import { useDisconnectAiAccount } from '@/components/app/use_ai_accounts';
import type { ModelProviderAccount } from '@/lib/api';

export function ApiKeyAccountRow({
  account,
  falls_back_to_credits,
  needs_a_paid_plan,
}: {
  account: ModelProviderAccount | undefined;
  falls_back_to_credits: boolean;
  needs_a_paid_plan: boolean;
}) {
  const [adding, set_adding] = useState(false);

  if (account) {
    return <ConnectedKeyRow account={account} falls_back_to_credits={falls_back_to_credits} />;
  }

  if (adding) {
    return (
      <AiAccountRow
        label="API key"
        detail="Pick a provider, then paste the key."
        action={
          <Button size="sm" variant="ghost" onClick={() => set_adding(false)}>
            Cancel
          </Button>
        }
      >
        <ApiKeyForm on_connected={() => set_adding(false)} />
      </AiAccountRow>
    );
  }

  return (
    <AiAccountRow
      label="API key"
      detail="OpenAI, Claude or a gateway"
      action={
        needs_a_paid_plan ? (
          <PlansLinkButton label="Add" />
        ) : (
          <Button size="sm" variant="outline" onClick={() => set_adding(true)}>
            Add
          </Button>
        )
      }
    />
  );
}

function ConnectedKeyRow({
  account,
  falls_back_to_credits,
}: {
  account: ModelProviderAccount;
  falls_back_to_credits: boolean;
}) {
  const provider = find_api_key_provider(account);
  const disconnect = useDisconnectAiAccount(account.provider_slot, account.display_name);
  const [confirming, set_confirming] = useState(false);
  const refused = credential_state(account) === 'invalid';

  return (
    <AiAccountRow
      logo={provider?.logo}
      label={
        <>
          <span>{account.display_name}</span>
          <code className="font-mono text-muted-foreground text-sm">
            {masked_secret_hint(account.secret_hint)}
          </code>
        </>
      }
      detail={
        refused ? (
          <span className="text-destructive">
            {account.error_message ?? `${account.display_name} rejected this key`}
          </span>
        ) : (
          <ConnectedDetail />
        )
      }
      action={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => set_confirming(true)}
          >
            {refused ? 'Remove' : 'Disconnect'}
          </Button>
          <DisconnectDialog
            provider_label={account.display_name}
            falls_back_to_credits={falls_back_to_credits}
            open={confirming}
            on_open_change={set_confirming}
            on_confirm={() => disconnect.mutate()}
          />
        </>
      }
    />
  );
}
