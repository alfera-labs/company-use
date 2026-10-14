// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserTimezoneRecorder } from '@/components/app/browser_timezone_recorder';
import { TimezoneSettings } from '@/components/app/timezone_settings';

let stored_timezone: string | null = null;
let saved_timezones: string[] = [];
let root: Root | null = null;

async function answer_as_the_api(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  if (!new URL(request.url).pathname.endsWith('/v1/me/timezone')) {
    return Response.json({ error: { code: 'not_found', message: 'No route' } }, { status: 404 });
  }
  if (request.method === 'PUT') {
    const body = (await request.json()) as { timezone: string };
    stored_timezone = body.timezone;
    saved_timezones.push(body.timezone);
  }
  return Response.json({ data: { timezone: stored_timezone } });
}

function set_browser_timezone(timezone: string) {
  const real_options = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...real_options,
    timeZone: timezone,
  });
}

async function load_page_in_browser_timezone(timezone: string) {
  set_browser_timezone(timezone);
  act(() => root?.unmount());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BrowserTimezoneRecorder),
        createElement(TimezoneSettings),
      ),
    ),
  );
  await vi.waitFor(() => expect(document.querySelector('select')).not.toBeNull());
}

function shown_timezone() {
  return document.querySelector<HTMLSelectElement>('select')?.value;
}

beforeEach(() => {
  stored_timezone = null;
  saved_timezones = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_as_the_api));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the time zone of the person', () => {
  it('is recorded from the browser on the first page load', async () => {
    await load_page_in_browser_timezone('Asia/Tokyo');

    expect(stored_timezone).toBe('Asia/Tokyo');
    expect(shown_timezone()).toBe('Asia/Tokyo');
  });

  it('is not overwritten by a later page load in another browser time zone', async () => {
    await load_page_in_browser_timezone('Asia/Tokyo');

    await load_page_in_browser_timezone('America/Los_Angeles');

    expect(saved_timezones).toEqual(['Asia/Tokyo']);
    expect(shown_timezone()).toBe('Asia/Tokyo');
  });

  it('shows the new time zone after the person chooses one in Settings', async () => {
    await load_page_in_browser_timezone('Asia/Tokyo');
    const select = document.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('The time zone control did not render');

    select.value = 'Europe/Rome';
    act(() => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() => expect(saved_timezones).toEqual(['Asia/Tokyo', 'Europe/Rome']));
    await vi.waitFor(() => expect(shown_timezone()).toBe('Europe/Rome'));
    expect(select.disabled).toBe(false);
  });
});
