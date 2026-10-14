// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFilesGridView } from '@/components/app/workspace_files_grid';

const host_root = {
  volume_ready: true as const,
  folder_path: '',
  folders: [
    { folder_name: '.venv', description: null, is_empty: false },
    { folder_name: 'companies', description: 'one page per company', is_empty: true },
    { folder_name: 'outputs', description: null, is_empty: false },
    { folder_name: 'tmp', description: null, is_empty: true },
  ],
  files: [
    { file_name: 'notes.md', byte_size: 12, last_modified_time: '2026-10-10T08:00:00.000Z' },
    { file_name: 'plan.md', byte_size: 40, last_modified_time: '2026-10-12T08:00:00.000Z' },
  ],
};

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

function render_root_listing(onOpenFolder: (path: string) => void = () => {}) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(WorkspaceFilesGridView, {
        listing: host_root,
        folderPath: '',
        onOpenFile: () => {},
        onOpenFolder,
      }),
    ),
  );
  return container;
}

function button_labels(container: HTMLElement) {
  return [...container.querySelectorAll('button')].map((button) => button.textContent);
}

function button_with_text(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`No button shows "${text}"`);
  return button;
}

describe('the top folder of the Files panel', () => {
  it('lists the work first, the empty folders last, and no hidden name', () => {
    const container = render_root_listing();

    expect(button_labels(container)).toEqual([
      'outputs',
      'plan.md',
      'notes.md',
      'companies',
      'Show hidden items (2)',
    ]);
    expect(container.textContent).toContain('Empty folders');
  });

  it('shows the hidden names when the person asks, and hides them again', () => {
    const container = render_root_listing();

    act(() => button_with_text(container, 'Show hidden items (2)').click());
    expect(button_labels(container)).toEqual([
      '.venv',
      'outputs',
      'plan.md',
      'notes.md',
      'companies',
      'tmp',
      'Hide hidden items',
    ]);

    act(() => button_with_text(container, 'Hide hidden items').click());
    expect(button_labels(container)).not.toContain('.venv');
  });

  it('opens an empty folder like any other folder', () => {
    const onOpenFolder = vi.fn();
    const container = render_root_listing(onOpenFolder);

    act(() => button_with_text(container, 'companies').click());

    expect(onOpenFolder).toHaveBeenCalledWith('companies');
  });
});
