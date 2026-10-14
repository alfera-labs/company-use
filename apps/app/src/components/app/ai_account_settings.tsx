import { model_source_words } from '@coworker/config/billing_words';
import { SegmentedControl, SegmentedControlItem } from '@coworker/ui/components/segmented-control';
import { SettingsCard } from '@coworker/ui/components/settings-card';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { AccountsUnavailable, PaymentSourceLine } from '@/components/app/ai_account_row';
import {
  find_api_key_account,
  find_chatgpt_account,
  other_active_accounts_remain,
} from '@/components/app/ai_account_rows';
import { ApiKeyAccountRow } from '@/components/app/api_key_connect_block';
import { ChatgptAccountRow } from '@/components/app/chatgpt_connect_block';
import {
  OwnAiPlanRequiredLine,
  useOwnAiNeedsAPaidPlan,
} from '@/components/app/own_ai_plan_required';
import { useAiAccounts, useSetBillingSource } from '@/components/app/use_ai_accounts';
import type { AiAccountsOverview, ModelBillingSource } from '@/lib/api';

export function AiAccountSettings() {
  const accounts_query = useAiAccounts();
  const needs_a_paid_plan = useOwnAiNeedsAPaidPlan();

  if (accounts_query.isLoading) return <Skeleton className="h-28 rounded-4xl" />;
  if (accounts_query.error || !accounts_query.data) {
    return (
      <SettingsCard>
        <AccountsUnavailable
          message={accounts_query.error?.message ?? ''}
          on_retry={() => void accounts_query.refetch()}
        />
      </SettingsCard>
    );
  }
  const overview = accounts_query.data;
  const chatgpt = find_chatgpt_account(overview.accounts);
  const api_key = find_api_key_account(overview.accounts);

  return (
    <SettingsCard>
      <div>
        <PaymentSourceLine pays_with_own_account={overview.billing_source === 'own_account'} />
        {needs_a_paid_plan ? (
          <p className="px-3.5 pb-3">
            <OwnAiPlanRequiredLine />
          </p>
        ) : null}
        <BillingSourceToggle overview={overview} />
      </div>
      <ChatgptAccountRow
        account={chatgpt}
        needs_a_paid_plan={needs_a_paid_plan}
        falls_back_to_credits={
          !chatgpt || !other_active_accounts_remain(overview.accounts, chatgpt)
        }
      />
      <ApiKeyAccountRow
        account={api_key}
        needs_a_paid_plan={needs_a_paid_plan}
        falls_back_to_credits={
          !api_key || !other_active_accounts_remain(overview.accounts, api_key)
        }
      />
    </SettingsCard>
  );
}

function BillingSourceToggle({ overview }: { overview: AiAccountsOverview }) {
  const set_source = useSetBillingSource();
  const has_working_account = overview.accounts.some(
    (account) => account.credential_status === 'active',
  );
  if (!has_working_account) return null;

  return (
    <div className="px-3.5 pb-3.5">
      <SegmentedControl
        aria-label="Who pays for runs"
        value={overview.billing_preference}
        disabled={set_source.isPending}
        onValueChange={(source: ModelBillingSource) => set_source.mutate(source)}
      >
        <SegmentedControlItem value="own_account">Your account</SegmentedControlItem>
        <SegmentedControlItem value="credits">
          {model_source_words.install_source_label}
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  );
}
