// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { KindFilters } from '@/components/app/automations/automation_kind';

it('shows All and every kind with its count, even a kind with none', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(KindFilters, {
        counts: { trigger: 5, scheduled: 0, goal: 0 },
        picked: 'all',
        onPick: () => undefined,
      }),
    ),
  );
  const pills = [...container.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent);
  expect(pills).toEqual(['All5', 'Triggers5', 'Scheduled0', 'Goals0']);
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
