import { useQuery } from '@tanstack/react-query';
import { type ComponentProps, useEffect, useRef } from 'react';
import { ConnectAppsStep as ConnectAppsForm } from '@/components/onboarding/connect_apps_step';
import { SlackStep as SlackConnectStep } from '@/components/onboarding/slack_step';
import { get_onboarding } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

function useWhatThisInstallHasSetUp() {
  const { data } = useQuery({ queryKey: query_keys.onboarding(), queryFn: get_onboarding });
  return data?.install;
}

export function useLeaveStepOnce(should_leave: boolean, leave: () => void) {
  const has_left = useRef(false);
  useEffect(() => {
    if (!should_leave || has_left.current) return;
    has_left.current = true;
    leave();
  }, [should_leave, leave]);
}

export function SlackStep(props: ComponentProps<typeof SlackConnectStep>) {
  const slack_is_set_up = useWhatThisInstallHasSetUp()?.slack_app_configured ?? true;
  useLeaveStepOnce(!slack_is_set_up, props.onSkip);
  return slack_is_set_up ? <SlackConnectStep {...props} /> : null;
}

export function ConnectAppsStep(props: ComponentProps<typeof ConnectAppsForm>) {
  const apps_are_set_up = useWhatThisInstallHasSetUp()?.app_provider_configured ?? true;
  useLeaveStepOnce(!apps_are_set_up, props.onAdvance);
  return apps_are_set_up ? <ConnectAppsForm {...props} /> : null;
}
