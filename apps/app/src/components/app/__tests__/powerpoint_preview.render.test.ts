// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PowerpointPreview } from '@/components/app/workspace_documents/powerpoint_preview';

type BuildingBlocksInput = {
  canEdit?: boolean;
  handle?: { current: unknown };
  onActiveSlideChange?: (index: number) => void;
  onSlideCountChange?: (count: number) => void;
};

const viewer = vi.hoisted(() => ({
  go_to_previous_slide: vi.fn(),
  go_to_next_slide: vi.fn(),
  building_blocks_input: null as BuildingBlocksInput | null,
}));

function full_viewer_with_ribbon_and_side_panes() {
  return createElement(
    'div',
    { 'data-full-viewer': true },
    'File Home Insert Draw Design Share Elements Properties Comments',
  );
}

vi.mock('pptx-react-viewer/viewer', () => ({
  PowerPointViewer: full_viewer_with_ribbon_and_side_panes,
}));

vi.mock('pptx-react-viewer', () => ({
  PowerPointViewer: full_viewer_with_ribbon_and_side_panes,
  Toolbar: full_viewer_with_ribbon_and_side_panes,
  SlideCanvas: () => createElement('div', { 'data-slide-canvas': true }, 'All About Apples'),
  ViewerThemeProvider: ({ children }: { children: ReactNode }) => children,
  useViewerBuildingBlocks: (input: BuildingBlocksInput) => {
    viewer.building_blocks_input = input;
    if (input.handle) {
      input.handle.current = {
        goPrev: viewer.go_to_previous_slide,
        goNext: viewer.go_to_next_slide,
      };
    }
    return { loading: false, error: null, canvasProps: {}, toolbarProps: {}, mode: 'preview' };
  },
}));

let root: Root | null = null;

let stylesheet_addresses: string[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stylesheet_addresses = [];
  vi.spyOn(HTMLLinkElement.prototype, 'href', 'set').mockImplementation((address) => {
    stylesheet_addresses.push(address);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render_deck() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(PowerpointPreview, { bytes: new ArrayBuffer(8), file_name: 'deck.pptx' }),
    ),
  );
  return container;
}

function slide_area(container: HTMLElement) {
  const host = [...container.querySelectorAll('div')].find((element) => element.shadowRoot);
  if (!host?.shadowRoot) throw new Error('The slide area did not render');
  return host.shadowRoot;
}

function button_named(container: HTMLElement, name: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!button) throw new Error(`No button is named "${name}"`);
  return button;
}

describe('a presentation in the Files panel', () => {
  it('shows the slide alone: no ribbon tabs, no Share, no properties pane', () => {
    const container = render_deck();
    const shown = `${container.textContent} ${slide_area(container).textContent}`;

    expect(slide_area(container).querySelector('[data-slide-canvas]')).not.toBeNull();
    expect(container.querySelector('[data-full-viewer]')).toBeNull();
    expect(slide_area(container).querySelector('[data-full-viewer]')).toBeNull();
    expect(shown).not.toMatch(/Share|Properties|Insert|Home/u);
    expect(viewer.building_blocks_input?.canEdit).toBe(false);
    expect(stylesheet_addresses).toEqual(['/pptx-react-viewer.css']);
  });

  it('moves between the slides and says which slide is in view', () => {
    const container = render_deck();
    act(() => viewer.building_blocks_input?.onSlideCountChange?.(3));

    expect(container.textContent).toContain('Slide 1 of 3');
    expect(button_named(container, 'Previous slide').disabled).toBe(true);

    act(() => button_named(container, 'Next slide').click());
    expect(viewer.go_to_next_slide).toHaveBeenCalledTimes(1);

    act(() => viewer.building_blocks_input?.onActiveSlideChange?.(2));
    expect(container.textContent).toContain('Slide 3 of 3');
    expect(button_named(container, 'Next slide').disabled).toBe(true);

    act(() => button_named(container, 'Previous slide').click());
    expect(viewer.go_to_previous_slide).toHaveBeenCalledTimes(1);
  });
});
