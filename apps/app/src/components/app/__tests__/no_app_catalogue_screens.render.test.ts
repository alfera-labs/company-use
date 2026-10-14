// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectAnythingSection } from '@/components/app/connect_anything_section';
import { HomeTaskGallery } from '@/components/app/home_task_gallery';
import { OfferAppsLine } from '@/components/onboarding/offer_apps_line';
import { query_keys } from '@/lib/api/query_keys';
import type { OnboardingSnapshot } from '@/lib/api/types';
import { home_templates } from '@/lib/home_template_catalog';

const sign_up_link = 'https://app.alfera.ai/sign-up?from=self-host';
const guide_link =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#connect-your-apps';

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function snapshot_of_an_install(app_provider_configured: boolean): OnboardingSnapshot {
  return {
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
      slack_app_configured: false,
      app_provider_configured,
      saved_credentials_reach_the_sandbox: false,
      sandbox_shows_a_live_browser: false,
      jobs_that_need_no_app: [],
    },
  };
}

function mount_on_an_install(
  install: { has_app_catalogue: boolean },
  screen: ReturnType<typeof createElement>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(query_keys.onboarding(), snapshot_of_an_install(install.has_app_catalogue));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(QueryClientProvider, { client }, screen)));
}

function links_on_screen() {
  return [...container.querySelectorAll('a')].map((link) => [
    link.textContent,
    link.getAttribute('href'),
  ]);
}

const without_a_key = { has_app_catalogue: false };
const with_a_key = { has_app_catalogue: true };

describe('the connect-apps screen', () => {
  const connect_section = createElement(ConnectAnythingSection, { onSelect: vi.fn() });

  it('says in one calm block what is missing, the one command, and where the guide is', () => {
    mount_on_an_install(without_a_key, connect_section);

    expect([...container.querySelectorAll('h2')].map((title) => title.textContent)).toEqual([
      'Apps need an app-provider key',
      'Connect anything',
    ]);
    expect(container.querySelector('p')?.textContent).toBe(
      'This install has no key for the app catalogue yet, so no app from it can connect. On the machine that runs Alfera, run ./alfera add apps, then reload this page. Read the guide, or use Alfera Cloud, where apps connect in one click.',
    );
    expect(container.querySelector('code')?.textContent).toBe('./alfera add apps');
    expect(container.textContent).not.toContain('3,000');
    expect(links_on_screen()).toEqual([
      ['Read the guide', guide_link],
      ['use Alfera Cloud', sign_up_link],
    ]);
  });

  it('shows a sample of the apps a key brings, and none of them can be pressed', () => {
    mount_on_an_install(without_a_key, connect_section);

    const sample = [...container.querySelectorAll('li')];
    expect(sample.length).toBe(12);
    expect(sample[0]?.textContent).toContain('Gmail');
    expect(sample.flatMap((app) => [...app.querySelectorAll('button, a')])).toEqual([]);
  });

  it('shows only the usual section when the install has a key', () => {
    mount_on_an_install(with_a_key, connect_section);

    expect([...container.querySelectorAll('h2')].map((title) => title.textContent)).toEqual([
      'Connect anything',
    ]);
    expect(links_on_screen()).toEqual([]);
  });
});

describe('the line under an onboarding offer', () => {
  const offer = {
    title: 'Your site loads an ads tag',
    body: 'x',
    prompt: 'Connect HubSpot, then x',
  };
  const hubspot = [{ name: 'HubSpot', logo_url: 'https://logo.example/hubspot.png' }];

  it('says both ways in one line when the offer needs an app the install can not connect', () => {
    mount_on_an_install(
      without_a_key,
      createElement(OfferAppsLine, { finding: { ...offer, tools: hubspot } }),
    );

    expect(container.textContent).toBe(
      'This job needs HubSpot: use your own key or use Alfera Cloud.',
    );
    expect(links_on_screen()).toEqual([
      ['use your own key', guide_link],
      ['use Alfera Cloud', sign_up_link],
    ]);
  });

  it('says it for an offer whose prompt opens with Connect and names no known app', () => {
    mount_on_an_install(
      without_a_key,
      createElement(OfferAppsLine, { finding: { ...offer, prompt: 'Connect my CRM, then x' } }),
    );

    expect(container.textContent).toBe(
      'This job needs a connected app: use your own key or use Alfera Cloud.',
    );
  });

  it('says nothing under an offer that runs today', () => {
    mount_on_an_install(
      without_a_key,
      createElement(OfferAppsLine, { finding: { ...offer, prompt: 'Every Friday, read x' } }),
    );

    expect(container.textContent).toBe('');
  });

  it('keeps the usual line when the install has a key', () => {
    mount_on_an_install(
      with_a_key,
      createElement(OfferAppsLine, { finding: { ...offer, tools: hubspot } }),
    );

    expect(container.textContent).toBe('Connect HubSpot.');
  });
});

describe('the templates on the home page', () => {
  const gallery = createElement(HomeTaskGallery, { apps: [], onSelectTemplate: vi.fn() });
  const need_an_app = home_templates.filter((template) => template.app_aliases.length > 0);
  const need_no_app = home_templates.filter((template) => template.app_aliases.length === 0);

  it('shows only templates that need no app when the install has no app catalogue key', () => {
    mount_on_an_install(without_a_key, gallery);
    const sales_that_need_no_app = need_no_app.filter((template) => template.category === 'sales');

    expect(sales_that_need_no_app.length).toBeGreaterThan(0);
    for (const template of sales_that_need_no_app) {
      expect(container.textContent).toContain(template.name);
    }
    for (const template of need_an_app) expect(container.textContent).not.toContain(template.name);
  });

  it('says once how many more need a connected app, with both ways', () => {
    mount_on_an_install(without_a_key, gallery);

    expect(container.textContent).toContain(`Browse all ${need_no_app.length} templates`);
    expect(container.querySelector('p')?.textContent).toBe(
      `${need_an_app.length} more templates need a connected app: use your own key or use Alfera Cloud.`,
    );
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(links_on_screen().slice(1)).toEqual([
      ['use your own key', guide_link],
      ['use Alfera Cloud', sign_up_link],
    ]);
  });

  it('has a template that needs no app in every department it shows', () => {
    for (const department of ['sales', 'support', 'finance', 'operations']) {
      expect(need_no_app.some((template) => template.category === department)).toBe(true);
    }
  });

  it('shows the featured templates and no extra line when the install has a key', () => {
    mount_on_an_install(with_a_key, gallery);

    expect(container.textContent).toContain(`Browse all ${home_templates.length} templates`);
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(container.textContent).toContain('Keep the CRM matching my inbox');
  });
});
