// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectAppsStep, SlackStep } from '@/components/onboarding/steps_this_install_offers';
import { query_keys } from '@/lib/api/query_keys';
import type { OnboardingSnapshot } from '@/lib/api/types';

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

type WhatIsSetUp = Pick<
  OnboardingSnapshot['install'],
  'slack_app_configured' | 'app_provider_configured'
>;

function snapshot_of_an_install(install: WhatIsSetUp): OnboardingSnapshot {
  return {
    completed: false,
    step: 'slack',
    channels_joined: 0,
    profile: null,
    agent_name: 'Coworker',
    workspace_name: 'Acme',
    email_domain: null,
    company_scan: null,
    slack: { connected: false, team_name: null, team_id: null, bot_user_id: null },
    install: {
      ...install,
      saved_credentials_reach_the_sandbox: false,
      sandbox_shows_a_live_browser: false,
      jobs_that_need_no_app: [],
    },
  };
}

function mount_step(install: WhatIsSetUp, step: ReturnType<typeof createElement>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(query_keys.onboarding(), snapshot_of_an_install(install));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(QueryClientProvider, { client }, step)));
}

describe('onboarding steps an install can not serve', () => {
  it('leaves the Slack step at once, and draws nothing, when no Slack app is set up', () => {
    const on_skip = vi.fn();

    mount_step(
      { slack_app_configured: false, app_provider_configured: true },
      createElement(SlackStep, { connected: false, onConnected: vi.fn(), onSkip: on_skip }),
    );

    expect(on_skip).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toBe('');
  });

  it('draws the Slack step when a Slack app is set up', () => {
    const on_skip = vi.fn();

    mount_step(
      { slack_app_configured: true, app_provider_configured: false },
      createElement(SlackStep, { connected: false, onConnected: vi.fn(), onSkip: on_skip }),
    );

    expect(on_skip).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Slack');
  });

  it('leaves the apps step at once, and draws nothing, when no app provider is set up', () => {
    const on_advance = vi.fn();

    mount_step(
      { slack_app_configured: false, app_provider_configured: false },
      createElement(ConnectAppsStep, {
        agentLabel: 'Coworker',
        isFinishing: false,
        onAdvance: on_advance,
      }),
    );

    expect(on_advance).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toBe('');
  });
});
