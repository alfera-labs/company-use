// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatConversation } from '@/components/app/chat_conversation';
import { Markdown } from '@/components/prompt-kit/markdown';
import { OpenWorkspaceFileProvider } from '@/components/prompt-kit/markdown_file_links';
import { query_keys } from '@/lib/api/query_keys';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

let root: Root | null = null;
let requests_to_the_api: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests_to_the_api = vi.fn(() => Promise.reject(new Error('This test asks the API nothing.')));
  vi.stubGlobal('fetch', requests_to_the_api);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function workspace_with_one_report() {
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace(), { workspace_id: 'ws_1' });
  client.setQueryData(query_keys.workspace_files('ws_1', 'files'), {
    volume_ready: true,
    folder_path: 'files',
    folders: [],
    files: [{ file_name: 'report.md', byte_size: 12, last_modified_time: null }],
  });
  client.setQueryData(query_keys.workspace_files('ws_1', ''), {
    volume_ready: true,
    folder_path: '',
    folders: [],
    files: [{ file_name: 'notes.md', byte_size: 4, last_modified_time: null }],
  });
  return client;
}

function render_in_a_chat(content: ReactNode, open_file: (file_path: string) => void = () => {}) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: workspace_with_one_report() },
        createElement(OpenWorkspaceFileProvider, { value: open_file }, content),
      ),
    ),
  );
  return container;
}

function answer(markdown: string) {
  return createElement(Markdown, null, markdown);
}

function button_labels(container: HTMLElement) {
  return [...container.querySelectorAll('button')].map((button) => button.textContent);
}

describe("a file path in the coworker's answer", () => {
  it('opens the file from inline code when the file exists', () => {
    const open_file = vi.fn();
    const container = render_in_a_chat(answer('I saved it to `files/report.md`.'), open_file);

    const link = container.querySelector('button');
    expect(link?.textContent).toBe('files/report.md');
    act(() => link?.click());

    expect(open_file).toHaveBeenCalledWith('files/report.md');
    expect(container.textContent).toContain('I saved it to files/report.md.');
  });

  it('opens the file from plain and bold text, and from the path the sandbox uses', () => {
    const open_file = vi.fn();
    const container = render_in_a_chat(
      answer(
        'See files/report.md, then **/workspace/files/report.md** and notes.md.\n\n- /files/report.md is the same file.',
      ),
      open_file,
    );

    expect(button_labels(container)).toEqual([
      'files/report.md',
      '/workspace/files/report.md',
      'notes.md',
      '/files/report.md',
    ]);
    act(() => container.querySelectorAll('button')[1]?.click());
    expect(open_file).toHaveBeenCalledWith('files/report.md');
  });

  it('leaves a path that does not exist as plain text', () => {
    const container = render_in_a_chat(
      answer('I could not write `files/missing.md`, files/other.csv or example.com in v3.12.'),
    );

    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain(
      'I could not write files/missing.md, files/other.csv or example.com in v3.12.',
    );
  });

  it('asks the API nothing for folders the Files panel already listed', () => {
    render_in_a_chat(answer('`files/report.md` and files/report.md and `files/missing.md`'));

    expect(requests_to_the_api).not.toHaveBeenCalled();
  });

  it('makes no link without a chat that can open files', () => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(answer('It is at `files/report.md`.')));

    expect(container.querySelector('button')).toBeNull();
  });
});

describe("a file path in the person's own message", () => {
  it('stays plain text, even when the file exists', () => {
    const container = render_in_a_chat(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_user',
            role: 'user',
            parts: [{ type: 'text', text: 'Open `files/report.md` and files/report.md' }],
          },
        ],
      }),
    );

    expect(container.textContent).toContain('Open `files/report.md` and files/report.md');
    expect(button_labels(container)).not.toContain('files/report.md');
  });
});
