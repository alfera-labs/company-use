import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeSlackStrip } from '@/components/app/slack/home_strip';
import { query_keys } from '@/lib/api/query_keys';
import type { OnboardingSnapshot } from '@/lib/api/types';

function render_home_strip(slack_app_configured: boolean) {
  const snapshot: OnboardingSnapshot = {
    completed: true,
    step: 'done',
    channels_joined: 0,
    profile: null,
    agent_name: 'Coworker',
    workspace_name: 'Acme',
    email_domain: null,
    company_scan: null,
    slack: { connected: false, team_name: null, team_id: null, bot_user_id: null },
    install: {
      slack_app_configured,
      app_provider_configured: false,
      saved_credentials_reach_the_sandbox: false,
      sandbox_shows_a_live_browser: false,
      jobs_that_need_no_app: [],
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(query_keys.onboarding(), snapshot);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(HomeSlackStrip)),
  );
}

describe('the Slack strip on the home page', () => {
  it('is not drawn on an install with no Slack app', () => {
    expect(render_home_strip(false)).toBe('');
  });

  it('offers Add to Slack on an install with a Slack app', () => {
    expect(render_home_strip(true)).toContain('Add to Slack');
  });
});
