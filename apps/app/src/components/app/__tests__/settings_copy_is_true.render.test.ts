// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectYourAppsLink } from '@/components/app/chat_prompt_input_controls';
import { describe_settings_section } from '@/components/app/settings_section_view';
import { find_settings_section } from '@/lib/settings_navigation';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
}));

const no_token = { profile_token: null, team_token_can_manage_users: false };
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

async function render_the_apps_link(app_provider_configured: boolean) {
  vi.stubGlobal('fetch', async () =>
    Response.json({ data: { install: { app_provider_configured } } }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(QueryClientProvider, { client }, createElement(ConnectYourAppsLink)),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

describe('the line under the Profile title', () => {
  const profile = find_settings_section('profile');

  it('promises no email and no password on an install that signs people in itself', () => {
    for (const context of [{ runs_in_local_mode: true }, { runs_in_team_mode: true }]) {
      const line = describe_settings_section(profile, { ...no_token, ...context });

      expect(line).toBe('How you sign in to this install.');
      expect(line).not.toMatch(/name|email|password/iu);
    }
  });

  it('stays as it is where the sign-in provider holds the account', () => {
    expect(describe_settings_section(profile, no_token)).toBe(profile.description);
  });
});

describe('the line under the Workspace title', () => {
  it('names only what the page has: the name and the ID', () => {
    expect(find_settings_section('workspace').description).toBe(
      'The name of your workspace, and its ID.',
    );
  });
});

describe('the "Connect your apps" link under the composer', () => {
  it('shows no Google and Slack mark on an install that can connect neither', async () => {
    const link = await render_the_apps_link(false);

    expect(link.querySelector('[aria-label="Google and Slack"]')).toBeNull();
    expect(link.textContent).toBe('Connect your apps');
  });

  it('shows the marks where the app catalogue is set up', async () => {
    const link = await render_the_apps_link(true);

    expect(link.querySelector('[aria-label="Google and Slack"]')).not.toBeNull();
  });
});
