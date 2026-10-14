// @vitest-environment happy-dom

import { CommandPalette as CommandPaletteRoot } from '@coworker/ui/components/command-palette';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalettePanel } from '@/components/app/command_palette/command_palette';
import { useCommandPaletteStore } from '@/components/app/command_palette/command_palette_store';

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useCommandPaletteStore.getState().open_command_palette();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Escape in the search box', () => {
  it('closes the search at once, also when text is typed in it', async () => {
    const panel = createElement(CommandPalettePanel, {
      groups: [],
      query_text: 'planets',
      set_query_text: () => {},
      choose_match: () => {},
    });
    await act(async () => root?.render(createElement(CommandPaletteRoot, { open: true }, panel)));
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Search"]');
    expect(field?.value).toBe('planets');

    await act(async () => {
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCommandPaletteStore.getState().is_open).toBe(false);
  });
});
