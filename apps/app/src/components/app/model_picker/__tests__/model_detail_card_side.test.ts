// @vitest-environment happy-dom

import { unrestricted_model_access } from '@coworker/shared';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { real_model_catalog_entries } from '@/components/app/model_picker/__tests__/real_model_catalog';
import { choose_this_model } from '@/components/app/model_picker/model_choice';
import { read_side_with_room_for_card } from '@/components/app/model_picker/model_detail_card';
import { ModelPickerView } from '@/components/app/model_picker/model_picker';

const a_model = real_model_catalog_entries[0] as (typeof real_model_catalog_entries)[number];

let root: Root | null = null;
let run_next_frame: () => void;
let place_of_the_menu: { left: number; right: number };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  run_next_frame = () =>
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
  place_of_the_menu = { left: 0, right: 416 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...place_of_the_menu, top: 0, bottom: 0, width: 416, height: 0 }) as DOMRect,
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open_the_menu() {
  await act(async () =>
    root?.render(
      createElement(ModelPickerView, {
        models: real_model_catalog_entries,
        value: choose_this_model(a_model),
        onChange: () => {},
        size: 'inline',
        model_access: unrestricted_model_access,
        default_open: true,
      }),
    ),
  );
}

const card = () => document.querySelector<HTMLElement>('[data-slot="combobox-popup"] > .w-60');

describe('the card beside the open model menu, on Home in a 1280 px window', () => {
  beforeEach(() => vi.stubGlobal('innerWidth', 1280));

  it('is not drawn while the menu is not in its place yet', async () => {
    await open_the_menu();

    expect(document.querySelector('[data-slot="combobox-popup"]')).not.toBeNull();
    expect(card()).toBeNull();
  });

  it('is drawn on the side that has room once the menu is in its place, and stays there', async () => {
    await open_the_menu();
    place_of_the_menu = { left: 660, right: 1076 };
    run_next_frame();

    expect(card()?.className).toContain('end-full');
    expect(card()?.className).not.toContain('start-full');
  });
});

describe('which side of the menu has room for the card', () => {
  it('is the left when the menu ends near the right edge, as on Home at 1280', () => {
    expect(read_side_with_room_for_card({ left: 660, right: 1076 }, 1280)).toBe('start');
  });

  it('is the right when the menu starts near the left edge', () => {
    expect(read_side_with_room_for_card({ left: 40, right: 456 }, 1280)).toBe('end');
  });

  it('is neither when the card would be cut on both sides', () => {
    expect(read_side_with_room_for_card({ left: 100, right: 516 }, 700)).toBeNull();
  });
});
