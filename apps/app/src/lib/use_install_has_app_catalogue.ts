import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { get_onboarding } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const client_of_a_render_outside_the_app = new QueryClient();

type WhatThisInstallHasSetUp = Awaited<ReturnType<typeof get_onboarding>>['install'];

function useWhatThisInstallHasSetUp(): WhatThisInstallHasSetUp | 'no query provider' | undefined {
  const app_client = useContext(QueryClientContext);
  const { data } = useQuery(
    {
      queryKey: query_keys.onboarding(),
      queryFn: get_onboarding,
      enabled: app_client !== undefined,
    },
    app_client ?? client_of_a_render_outside_the_app,
  );
  return app_client ? data?.install : 'no query provider';
}

/**
 * Whether this install can connect an app from the catalogue. Undefined while the answer loads.
 * A render with no query provider (a static render of one component) reads as true.
 */
export function useInstallHasAppCatalogue(): boolean | undefined {
  const install = useWhatThisInstallHasSetUp();
  return install === 'no query provider' ? true : install?.app_provider_configured;
}

/**
 * Whether a credential saved in the dashboard (an HTTP API key, a website sign-in) reaches the
 * sandbox of this install. Only one kind of sandbox attaches it. Undefined while the answer
 * loads; a render with no query provider reads as true.
 */
export function useSavedCredentialsReachTheSandbox(): boolean | undefined {
  const install = useWhatThisInstallHasSetUp();
  return install === 'no query provider' ? true : install?.saved_credentials_reach_the_sandbox;
}

/**
 * Whether the sandbox of this install has a browser a person can watch. Only one kind of
 * sandbox has one. Undefined while the answer loads; a render with no query provider reads as
 * true.
 */
export function useSandboxShowsALiveBrowser(): boolean | undefined {
  const install = useWhatThisInstallHasSetUp();
  return install === 'no query provider' ? true : install?.sandbox_shows_a_live_browser;
}
