// @vitest-environment happy-dom

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocxPageArea,
  type DocxZoomChoice,
  DocxZoomSelect,
  zoom_that_fits_page,
} from '@/components/app/workspace_documents/docx_page_zoom';

const letter_page_width_px = 816;
let root: Root | null = null;
let report_area_width: (width_px: number) => void = () => {};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(on_resize: (entries: { contentRect: { width: number } }[]) => void) {
        report_area_width = (width_px) => on_resize([{ contentRect: { width: width_px } }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(420);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function DocumentInPanel() {
  const [zoom_choice, set_zoom_choice] = useState<DocxZoomChoice>('fit');
  return createElement(
    'div',
    null,
    createElement(
      DocxPageArea,
      { page_width_px: letter_page_width_px, zoom_choice },
      createElement('div', { id: 'page', style: { width: letter_page_width_px } }),
    ),
    createElement(DocxZoomSelect, { zoom_choice, onChange: set_zoom_choice }),
  );
}

function render_document() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(DocumentInPanel)));
  return container;
}

function page_zoom(container: HTMLElement) {
  const zoomed = container.querySelector<HTMLElement>('#page')?.parentElement;
  if (!zoomed) throw new Error('The page did not render');
  return Number(zoomed.style.zoom);
}

function choose_zoom(container: HTMLElement, value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Zoom"]');
  if (!select) throw new Error('The zoom choice did not render');
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('a Word page in a narrow Files panel', () => {
  it('is fully in view in a 420 px panel when it opens', () => {
    const container = render_document();

    const zoom = page_zoom(container);
    expect(zoom).toBeCloseTo(396 / 816, 5);
    expect(letter_page_width_px * zoom).toBeLessThanOrEqual(420);
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('fit');
  });

  it('stays fully in view when the panel changes width', () => {
    const container = render_document();

    act(() => report_area_width(380));
    expect(letter_page_width_px * page_zoom(container)).toBeLessThanOrEqual(380);

    act(() => report_area_width(560));
    expect(page_zoom(container)).toBeCloseTo(536 / 816, 5);
  });

  it('shows the page at its real size when the person picks 100%, and fits again on "Fit"', () => {
    const container = render_document();

    choose_zoom(container, '1');
    expect(page_zoom(container)).toBe(1);

    choose_zoom(container, 'fit');
    expect(page_zoom(container)).toBeCloseTo(396 / 816, 5);
  });

  it('does not make the page larger than its real size in a wide panel', () => {
    expect(zoom_that_fits_page(1248, letter_page_width_px)).toBe(1);
    expect(zoom_that_fits_page(0, letter_page_width_px)).toBe(1);
  });
});
