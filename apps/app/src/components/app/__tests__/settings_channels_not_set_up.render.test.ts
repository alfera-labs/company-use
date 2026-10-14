// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type FunctionComponent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSettings } from '@/components/app/channel_settings';
import { EmailAddressSettings } from '@/components/app/email_address_settings';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
}));

type InstallState = { slack_app_configured: boolean; slack_connected: boolean };

let root: Root | null = null;
let requested_paths: string[];
let failed_statuses: number[];

function answer_like_an_install(install: InstallState) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(new Request(input, init).url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    requested_paths.push(path);
    if (path === '/v1/onboarding') {
      return Response.json({
        data: {
          slack: { connected: install.slack_connected },
          install: { slack_app_configured: install.slack_app_configured },
        },
      });
    }
    if (path === '/v1/workspace/email-address') {
      return Response.json({ data: { available: false, email_address: null } });
    }
    failed_statuses.push(409);
    return Response.json(
      {
        error: { code: 'slack_not_connected', message: 'Connect Slack before managing channels.' },
      },
      { status: 409 },
    );
  });
}

async function render_page(page: FunctionComponent) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(createElement(QueryClientProvider, { client }, createElement(page))),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requested_paths = [];
  failed_statuses = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Settings > Channels when Slack is not there', () => {
  it('says Slack is not set up, with no error and no failing request', async () => {
    answer_like_an_install({ slack_app_configured: false, slack_connected: false });

    const page = await render_page(ChannelSettings);

    expect(page.textContent).toContain('Slack is not set up');
    expect(page.textContent).not.toContain('Connect Slack before managing channels');
    expect(page.querySelector('.text-destructive')).toBeNull();
    expect([...page.querySelectorAll('button')].map((button) => button.textContent)).toEqual([]);
    expect(requested_paths).toEqual(['/v1/onboarding']);
    expect(failed_statuses).toEqual([]);
  });

  it('says Slack is not connected and links to where it connects', async () => {
    answer_like_an_install({ slack_app_configured: true, slack_connected: false });

    const page = await render_page(ChannelSettings);

    expect(page.textContent).toContain('Slack is not connected yet.');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/integrations');
    expect(requested_paths).toEqual(['/v1/onboarding']);
    expect(failed_statuses).toEqual([]);
  });
});

describe('Settings > Email when email is not there', () => {
  it('says email is not set up, as a note and not as an error', async () => {
    answer_like_an_install({ slack_app_configured: false, slack_connected: false });

    const page = await render_page(EmailAddressSettings);

    expect(page.textContent).toMatch(/Email is not (set up|enabled)/u);
    expect(page.querySelector('.text-destructive')).toBeNull();
    expect(failed_statuses).toEqual([]);
  });
});
