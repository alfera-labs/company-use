// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { edition_settings_panels } from '@/components/app/edition_settings_panels';
import { settings_section_panels } from '@/components/app/settings_section_panels';
import {
  find_settings_section,
  settings_group_definitions,
  settings_section_definitions,
} from '@/lib/settings_navigation';

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

it('lists one Settings page for the hosted product, last, in the last group', () => {
  const section = find_settings_section('alfera-cloud');
  const titles = settings_section_definitions.map((entry) => entry.title);

  expect(section.title).toBe('Alfera Cloud');
  expect(titles.at(-1)).toBe('Alfera Cloud');
  expect(section.group).toBe(settings_group_definitions.at(-1)?.group_id);
  expect(settings_section_definitions.filter((entry) => entry.group === section.group)).toEqual([
    section,
  ]);
  expect(titles).not.toContain('Member links');
  expect(titles).not.toContain('Notifications');
});

it('gives every settings entry a panel, and a retired entry the first page', () => {
  expect(Object.keys(settings_section_panels).sort()).toEqual(
    settings_section_definitions.map((entry) => entry.section_id).sort(),
  );
  expect(find_settings_section('member-links')).toBe(settings_section_definitions[0]);
  expect(find_settings_section('attention')).toBe(settings_section_definitions[0]);
});

it('shows what this install does, what the cloud adds, one way there, and no price', async () => {
  const panel = edition_settings_panels['alfera-cloud']();
  await act(async () => root.render(createElement('div', null, panel)));

  expect([...container.querySelectorAll('h2')].map((title) => title.textContent)).toEqual([
    'This install',
    'Alfera Cloud adds',
  ]);
  expect(container.querySelectorAll('ul')).toHaveLength(2);
  expect(container.textContent).toContain('Runs automations while this machine is on');
  expect(container.textContent).toContain('Apps that connect in one click');
  expect(container.textContent).toContain('Company memory');
  expect(container.textContent).not.toContain('Automations that start when something happens');
  expect(container.textContent).toContain('Member links');
  expect(container.textContent).not.toMatch(/[$€£]|\bprice|\bper month|\bfree\b/iu);
  const actions = [...container.querySelectorAll('a, button')];
  expect(actions.map((action) => action.textContent)).toEqual(['Open Alfera Cloud']);
  expect(actions[0]?.getAttribute('href')).toBe('https://app.alfera.ai/sign-up?from=self-host');
});
