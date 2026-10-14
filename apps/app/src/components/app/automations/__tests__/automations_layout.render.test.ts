// @vitest-environment happy-dom
// biome-ignore-all lint/correctness/noChildrenProp: a .ts test has no JSX, and createElement only type-checks a required `children` when it is in the props.

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children?: ReactNode;
    to?: string;
    search?: Record<string, string>;
    'aria-current'?: string;
    'data-lead'?: boolean;
  }) =>
    createElement(
      'a',
      {
        href: search ? `${to}?${new URLSearchParams(search).toString()}` : to,
        'aria-current': rest['aria-current'],
        'data-lead': rest['data-lead'],
      },
      children,
    ),
}));

import { AutomationsLayout } from '@/components/app/automations/automations_layout';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function page_links() {
  return [...container.querySelectorAll('nav[aria-label="Automations pages"] a')];
}

describe('the automations frame', () => {
  it('links Automations, Activity and Notifications as pages, with no Goals or Ideas and no fake tabs', () => {
    act(() =>
      root.render(createElement(AutomationsLayout, { current: 'activity', children: 'rows' })),
    );

    expect(page_links().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Automations', '/automations'],
      ['Activity', '/automations/activity'],
      ['Notifications', '/automations/notifications'],
    ]);
    expect(container.querySelector('[role="tab"]')).toBeNull();
  });

  it('marks only the page it is given as the current one', () => {
    for (const current of ['automations', 'activity', 'notifications'] as const) {
      act(() => root.render(createElement(AutomationsLayout, { current, children: 'rows' })));
      const marked = page_links().filter((link) => link.getAttribute('aria-current') === 'page');
      expect(marked.map((link) => link.getAttribute('href'))).toEqual([
        current === 'automations' ? '/automations' : `/automations/${current}`,
      ]);
    }
  });

  it('marks no page for a page outside the three', () => {
    act(() => root.render(createElement(AutomationsLayout, { children: 'ideas' })));
    expect(page_links()).toHaveLength(3);
    expect(page_links().filter((link) => link.hasAttribute('aria-current'))).toEqual([]);
  });

  it('puts New automation next to the title as the one primary button', () => {
    act(() =>
      root.render(createElement(AutomationsLayout, { current: 'automations', children: 'rows' })),
    );

    const title = container.querySelector('h1');
    expect(title?.textContent).toBe('Automations');
    expect(title?.parentElement?.textContent).toContain('New automation');
  });
});

describe('starting a new automation', () => {
  it('is one button that asks how, in a sheet: chat first and big, the other two as rows', async () => {
    act(() =>
      root.render(createElement(AutomationsLayout, { current: 'automations', children: 'rows' })),
    );
    const links = [...container.querySelectorAll('a')].map((link) => link.textContent);
    expect(links).not.toContain('Build it yourself');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const open = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'New automation',
    );
    await act(async () => open?.click());
    const ways = [...document.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a')];
    expect(
      ways.map((way) => [way.querySelector('span span')?.textContent, way.getAttribute('href')]),
    ).toEqual([
      ['Describe it in chat', '/home?prompt=Help+me+set+up+a+new+automation'],
      ['Build it yourself', '/automations/new'],
      ['Start from a template', '/templates'],
    ]);
    expect(ways[0]?.getAttribute('data-lead')).toBe('true');
  });
});
