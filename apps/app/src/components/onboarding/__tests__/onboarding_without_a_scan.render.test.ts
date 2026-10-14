// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CompanyScanRequest, CompanyStep } from '@/components/onboarding/company_step';
import { RevealStep } from '@/components/onboarding/reveal_step';
import { ScanStep } from '@/components/onboarding/scan_step';
import type { CompanyScan } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import type { OnboardingSnapshot } from '@/lib/api/types';

const install_with_one_model_key: OnboardingSnapshot = {
  completed: false,
  step: null,
  channels_joined: 0,
  profile: null,
  agent_name: 'Coworker',
  workspace_name: 'Workspace',
  email_domain: null,
  company_scan: null,
  slack: { connected: false, team_name: null, team_id: null, bot_user_id: null },
  install: {
    slack_app_configured: false,
    app_provider_configured: false,
    saved_credentials_reach_the_sandbox: false,
    sandbox_shows_a_live_browser: false,
    jobs_that_need_no_app: [
      {
        name: 'A task on a schedule',
        offer: "I'll run a task you describe every weekday at 9:00.",
        steps: ['You tell me the task once', 'Every weekday at 9:00 I run it'],
        title: 'A task that runs on a schedule',
        body: 'You describe a task once. I run it every weekday at 9:00.',
        prompt: 'Create a scheduled task for every weekday at 9:00.',
        first_question: 'What should I do every weekday at 9:00?',
      },
      {
        name: 'Tidy a folder',
        offer: "I'll sort the files in your workspace folder.",
        steps: ['I read the files', 'I rename and group them'],
        title: 'A tidy workspace folder',
        body: 'I sort the files in your workspace folder.',
        prompt: 'Sort the files in the workspace folder.',
        first_question: 'Which folder should I sort first?',
      },
    ],
  },
};

const outside_call = vi.fn(async () => {
  throw new Error('onboarding called an outside service');
});

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', outside_call);
  outside_call.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function show(screen: ReturnType<typeof createElement>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(query_keys.onboarding(), install_with_one_model_key);
  act(() => root?.unmount());
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(QueryClientProvider, { client }, screen)));
}

function text_of(selector: string) {
  return [...container.querySelectorAll(selector)].map((element) => element.textContent);
}

describe('onboarding on an install with no company scan', () => {
  it('asks for no website, runs no scan, and shows the jobs the install says need no app', () => {
    const scan_requests: CompanyScanRequest[] = [];
    const scans: CompanyScan[] = [];

    show(
      createElement(CompanyStep, {
        emailDomain: 'example.com',
        onSubmit: (request) => scan_requests.push(request),
      }),
    );
    expect(container.textContent).toBe('');
    expect(scan_requests).toEqual([{}]);

    show(createElement(ScanStep, { request: {}, onScanned: (scan) => scans.push(scan) }));
    expect(container.textContent).toBe('');
    expect(scans).toHaveLength(1);
    const [scan] = scans as [CompanyScan];
    expect(scan.findings.every((job) => !job.tools && !/^connect\s/iu.test(job.prompt))).toBe(true);

    show(createElement(RevealStep, { scan, onAdvance: vi.fn() }));
    expect(text_of('.ob-subtitle')).toEqual([
      "I can run these jobs on this install today, with no app connected. Here's how the first one would run.",
    ]);
    expect([...text_of('.ob-run__say'), ...text_of('.ob-waiting__say')]).toEqual([
      "I'll run a task you describe every weekday at 9:00.",
      "I'll sort the files in your workspace folder.",
    ]);
    expect(text_of('.ob-run__connect')).toEqual([]);
    expect(outside_call).not.toHaveBeenCalled();
  });

  it('hands the job on the stage to the next step when the person presses Get to work', () => {
    const picked: (string | undefined)[] = [];
    const scan: CompanyScan = {
      company_name: '',
      summary: '',
      scan_facts: [],
      findings: install_with_one_model_key.install.jobs_that_need_no_app,
      scanned_url: null,
      scanned_at: new Date(0).toISOString(),
    };
    show(createElement(RevealStep, { scan, onAdvance: (job) => picked.push(job?.name) }));

    act(() => container.querySelector<HTMLButtonElement>('.ob-btn')?.click());
    act(() => container.querySelector<HTMLButtonElement>('.ob-waiting__row')?.click());
    act(() => container.querySelector<HTMLButtonElement>('.ob-btn')?.click());

    expect(picked).toEqual(['A task on a schedule', 'Tidy a folder']);
  });
});
