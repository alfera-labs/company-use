// @vitest-environment happy-dom
// biome-ignore-all lint/correctness/noChildrenProp: a .ts test has no JSX, and createElement only type-checks a required `children` when it is in the props.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

function build_router(path: string) {
  const root_route = createRootRoute({ component: () => createElement(Outlet) });
  const page = (route_path: string, current?: 'automations' | 'activity' | 'notifications') =>
    createRoute({
      getParentRoute: () => root_route,
      path: route_path,
      component: () => createElement(AutomationsLayout, { current, children: 'rows' }),
    });
  const routes = [
    page('/automations', 'automations'),
    page('/automations/activity', 'activity'),
    page('/automations/notifications', 'notifications'),
    page('/automations/ideas'),
  ];
  return createRouter({
    routeTree: root_route.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

async function marked_links_at(path: string) {
  const router = build_router(path);
  await act(async () => {
    await router.load();
    root.render(createElement(RouterProvider, { router } as never));
  });
  const links = [...container.querySelectorAll('nav[aria-label="Automations pages"] a')];
  return links
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.getAttribute('href'));
}

it('marks exactly one tab on each page, under the real router', async () => {
  expect(await marked_links_at('/automations/activity')).toEqual(['/automations/activity']);
  expect(await marked_links_at('/automations/notifications')).toEqual([
    '/automations/notifications',
  ]);
  expect(await marked_links_at('/automations')).toEqual(['/automations']);
  expect(await marked_links_at('/automations/ideas')).toEqual([]);
});
