// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { WorkspaceFilesPanel } from '@/components/app/workspace_files_panel';
import { query_keys } from '@/lib/api/query_keys';

const no_views = { render_file: () => null, render_listing: () => null, browser: null };
const what_the_install_has = { install: { sandbox_shows_a_live_browser: false } };
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(new Request(input, init).url).pathname;
    return Response.json({ data: path.endsWith('/onboarding') ? what_the_install_has : [] });
  });
  Element.prototype.scrollIntoView = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(query_keys.onboarding(), what_the_install_has);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const panel = createElement(WorkspaceFilesPanel, {
    onClose: () => {},
    sandboxPreviews: [],
    session_id: 'ses_1',
    workspace_id: 'ws_1',
    file_views: no_views,
  });
  act(() => root?.render(createElement(QueryClientProvider, { client }, panel)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function open_in_the_panel(file_path: string) {
  await act(async () => useChatUiStore.getState().open_workspace_file_in_panel(file_path));
}

const words_of = (selector: string) => document.querySelector(selector)?.textContent ?? '';
const times = (words: string, name: string) => words.split(name).length - 1;

describe('the expanded Files panel', () => {
  it('draws one shadow, the one that dims the page behind it', async () => {
    const panel = document.querySelector('dialog');
    const shadows = () => [...(panel?.classList ?? [])].filter((name) => name.includes('shadow-'));
    expect(shadows()).toEqual(['xl:shadow-float']);

    await act(async () => {
      document.querySelector<HTMLElement>('[aria-label="Expand panel"]')?.click();
    });

    expect(shadows()).toEqual(['xl:shadow-[0_0_0_100vmax_var(--scrim)]']);
  });
});

describe('the Files panel with a file open', () => {
  it('says the name of the file once, on its tab, and its folder in the header', async () => {
    await open_in_the_panel('files/reports/tip-calculator.html');

    expect(times(words_of('dialog'), 'tip-calculator.html')).toBe(1);
    expect(words_of('[aria-current="page"]')).toContain('tip-calculator.html');
    expect(words_of('dialog header')).toBe('Filesfiles/reports');
  });

  it('says no folder for a file that is in no folder', async () => {
    await open_in_the_panel('notes.md');

    expect(times(words_of('dialog'), 'notes.md')).toBe(1);
    expect(words_of('dialog header')).toBe('Files');
  });
});
