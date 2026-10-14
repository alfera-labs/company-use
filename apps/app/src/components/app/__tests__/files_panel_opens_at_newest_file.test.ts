// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  folder_of_newest_file,
  use_folder_of_newest_chat_file,
} from '@/components/app/use_folder_of_newest_chat_file';

let root: Root | null = null;
let files_of_run: Record<string, { workspace_path: string | null; created_time: string }[]>;
let seen: (string | null | undefined)[];

function PanelThatOpensAt({ is_open }: { is_open: boolean }) {
  seen.push(use_folder_of_newest_chat_file('ses_1', is_open));
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  seen = [];
  files_of_run = {
    run_2: [],
    run_1: [
      { workspace_path: 'files/old.txt', created_time: '2026-10-12T17:00:00.000Z' },
      { workspace_path: 'files/demo/notes.txt', created_time: '2026-10-12T17:05:00.000Z' },
      { workspace_path: null, created_time: '2026-10-12T17:06:00.000Z' },
    ],
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(new Request(input, init).url).pathname;
    const run_id = path.match(/\/runs\/([^/]+)\/files$/u)?.[1];
    if (run_id) return Response.json({ data: files_of_run[run_id] ?? [] });
    return Response.json({ data: [{ run_id: 'run_2' }, { run_id: 'run_1' }] });
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function show_panel(is_open: boolean) {
  await act(async () => {
    root?.render(createElement(PanelThatOpensAt, { is_open }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const folders_shown = () => seen.filter((folder, at) => at === 0 || folder !== seen[at - 1]);

describe('where the Files panel of a chat opens', () => {
  it('is no folder while the panel is closed, then the folder of the file the chat wrote last', async () => {
    await show_panel(false);
    expect(folders_shown()).toEqual([undefined]);

    await show_panel(true);

    expect(folders_shown()).toEqual([undefined, 'files/demo']);
  });

  it('never shows one folder and then another when the panel is opened again', async () => {
    await show_panel(true);
    await show_panel(false);
    files_of_run.run_2 = [
      { workspace_path: 'files/report.pdf', created_time: '2026-10-12T18:00:00.000Z' },
    ];
    await show_panel(true);

    expect(folders_shown()).toEqual([undefined, 'files/demo', undefined, 'files']);
  });

  it('is the top of the workspace for a chat that wrote no file', async () => {
    files_of_run = {};
    await show_panel(true);

    expect(folders_shown()).toEqual([undefined, null]);
  });
});

describe('the folder of the newest file', () => {
  it('is the top folder for a file written at the top, and nothing for no record', () => {
    const at_the_top = [{ workspace_path: 'notes.txt', created_time: '2026-10-12T17:00:00.000Z' }];

    expect(folder_of_newest_file(at_the_top)).toBe('');
    expect(folder_of_newest_file([])).toBeNull();
  });
});
