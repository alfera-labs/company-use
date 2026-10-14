import { public_brand_config, public_env } from '@coworker/config/public_env';
import { format_error_message } from '@coworker/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BrandLogo } from '@/components/app/brand_logo';
import { WorkspaceSwitcher } from '@/components/app/workspace_switcher';
import { ChooseChannelsStep } from '@/components/onboarding/choose_channels_step';
import { type CompanyScanRequest, CompanyStep } from '@/components/onboarding/company_step';
import { GoStep } from '@/components/onboarding/go_step';
import { LogOutButton } from '@/components/onboarding/log_out_button';
import {
  type OnboardingStepKey,
  onboarding_steps,
  step_index_for,
  step_index_of,
} from '@/components/onboarding/onboarding_data';
import { RevealStep } from '@/components/onboarding/reveal_step';
import { ScanStep } from '@/components/onboarding/scan_step';
import { ConnectAppsStep, SlackStep } from '@/components/onboarding/steps_this_install_offers';
import { useFinishOnboarding } from '@/components/onboarding/use_finish_onboarding';
import {
  type CompanyScan,
  get_onboarding,
  read_company_scan,
  read_email_domain,
  send_onboarding_welcome,
  set_onboarding_step,
  skip_onboarding_for_dev,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { OnboardingSnapshot } from '@/lib/api/types';

const agent_label = public_brand_config.product_brand_name;

export function OnboardingWizard({
  initialState,
  return_to = '/',
}: {
  initialState: OnboardingSnapshot;
  return_to?: string;
}) {
  const onboarding_query = useQuery({
    queryKey: query_keys.onboarding(),
    queryFn: get_onboarding,
    initialData: initialState,
  });
  const snapshot = onboarding_query.data ?? initialState;

  const [company_scan, set_company_scan] = useState(() => read_company_scan(initialState));
  const [scan_request, set_scan_request] = useState<CompanyScanRequest | null>(null);
  const [step_index, set_step_index] = useState(() =>
    step_index_for({ step: initialState.step, company_scan: read_company_scan(initialState) }),
  );

  const go_to = useCallback((key: OnboardingStepKey) => set_step_index(step_index_of(key)), []);

  const scan_company = useCallback(
    (request: CompanyScanRequest) => {
      set_scan_request(request);
      go_to('scan');
    },
    [go_to],
  );

  const reveal_scan = useCallback(
    (scan: CompanyScan) => {
      set_company_scan(scan);
      go_to(scan.findings.length > 0 ? 'reveal' : 'slack');
    },
    [go_to],
  );

  const send_welcome = useMutation({ mutationFn: send_onboarding_welcome }).mutate;
  const welcome_fired = useRef(false);
  const finish_channels = useCallback(() => {
    if (!welcome_fired.current) {
      welcome_fired.current = true;
      send_welcome();
    }
    go_to('connect_apps');
  }, [send_welcome, go_to]);

  const { is_finishing, finish_and_leave, remember_picked_job } = useFinishOnboarding(return_to);

  const dev_skip = useMutation({
    mutationFn: skip_onboarding_for_dev,
    onSuccess: () => window.location.replace(return_to),
    onError: (error) => {
      toast.error(format_error_message(error, 'Dev skip failed.'));
    },
  });

  const persist_step = useMutation({ mutationFn: set_onboarding_step }).mutate;
  const is_mounted = useRef(false);
  useEffect(() => {
    if (!is_mounted.current) {
      is_mounted.current = true;
      return;
    }
    const key = onboarding_steps[step_index]?.key;
    if (key) persist_step(key);
  }, [step_index, persist_step]);

  const current_key = onboarding_steps[step_index]?.key ?? 'company';
  const visible_key = drawable_step(current_key, { scan_request, company_scan });
  const workspace_name = snapshot.workspace_name?.trim() || 'your workspace';

  return (
    <div className="ob-root">
      <header className="ob-topbar">
        <span className="ob-brand">
          <BrandLogo className="ob-brand__logo" />
        </span>
        <div className="col-start-3 ob-topbar__right">
          <WorkspaceSwitcher current_name={workspace_name} single_workspace_view="hidden" />
          {public_env.NEXT_PUBLIC_ENVIRONMENT === 'development' ? (
            <button
              className="ob-quiet ob-logout"
              type="button"
              disabled={dev_skip.isPending}
              onClick={() => dev_skip.mutate()}
            >
              Skip (dev)
            </button>
          ) : null}
          <LogOutButton />
        </div>
      </header>

      <main className="ob-stage">
        {visible_key === 'company' ? (
          <CompanyStep emailDomain={read_email_domain(snapshot)} onSubmit={scan_company} />
        ) : null}
        {visible_key === 'scan' && scan_request ? (
          <ScanStep request={scan_request} onScanned={reveal_scan} />
        ) : null}
        {visible_key === 'reveal' && company_scan ? (
          <RevealStep
            scan={company_scan}
            onAdvance={(picked_job) => {
              remember_picked_job(picked_job);
              go_to('slack');
            }}
          />
        ) : null}
        {visible_key === 'slack' ? (
          <SlackStep
            connected={snapshot.slack.connected}
            onConnected={() => go_to('channels')}
            onSkip={() => go_to('connect_apps')}
          />
        ) : null}
        {visible_key === 'channels' ? (
          <ChooseChannelsStep
            agentLabel={agent_label}
            workspaceName={workspace_name}
            onAdvance={finish_channels}
          />
        ) : null}
        {visible_key === 'connect_apps' ? (
          <ConnectAppsStep
            agentLabel={agent_label}
            isFinishing={is_finishing}
            onAdvance={() => (snapshot.slack.connected ? go_to('go') : void finish_and_leave(null))}
          />
        ) : null}
        {visible_key === 'go' ? (
          <GoStep
            isFinishing={is_finishing}
            slackBotUserId={snapshot.slack.bot_user_id ?? null}
            slackTeamId={snapshot.slack.team_id ?? null}
            onOpenDashboard={() => void finish_and_leave(null)}
            onOpenSlack={(slack_url) => void finish_and_leave(slack_url)}
          />
        ) : null}
      </main>
    </div>
  );
}

function drawable_step(
  key: OnboardingStepKey,
  held: { scan_request: CompanyScanRequest | null; company_scan: CompanyScan | null },
): OnboardingStepKey {
  if (key === 'scan' && !held.scan_request) return 'company';
  if (key === 'reveal' && !held.company_scan) return 'company';
  return key;
}
