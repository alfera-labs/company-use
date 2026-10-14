// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFileTabs } from '@/components/app/workspace_file_tabs';

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render_tabs(handlers: {
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(WorkspaceFileTabs, {
        activeTab: 'files/plan.md',
        dirtyTabs: ['files/budget.xlsx'],
        openTabs: ['files/plan.md', 'files/budget.xlsx'],
        onNewTab: () => {},
        ...handlers,
      }),
    ),
  );
  return container;
}

function button_with_text(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`No button shows "${text}"`);
  return button;
}

describe('the tabs of the open files', () => {
  it('shows one tab per file, marks the active one and the one with unsaved changes', () => {
    const container = render_tabs({ onActivate: () => {}, onClose: () => {} });

    expect(button_with_text(container, 'plan.md').getAttribute('aria-current')).toBe('page');
    expect(button_with_text(container, 'budget.xlsx').getAttribute('aria-current')).toBeNull();
    const unsaved_marks = container.querySelectorAll('[aria-label="Unsaved changes"]');
    expect(unsaved_marks).toHaveLength(1);
    expect(unsaved_marks[0]?.parentElement?.textContent).toBe('budget.xlsx');
  });

  it('opens a file from its name and closes it from the button in the icon slot', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const container = render_tabs({ onActivate, onClose });

    act(() => button_with_text(container, 'budget.xlsx').click());
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close budget.xlsx"]')?.click(),
    );

    expect(onActivate).toHaveBeenCalledWith('files/budget.xlsx');
    expect(onClose).toHaveBeenCalledWith('files/budget.xlsx');
  });
});
