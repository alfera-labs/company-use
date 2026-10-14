// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const set_trigger_status = vi.hoisted(() => vi.fn(async () => undefined));
const task = (trigger_id: string, trigger_status: string) => ({
  trigger_id,
  trigger_name: `Task ${trigger_id}`,
  trigger_type: 'schedule',
  trigger_status,
  schedule_expression: '0 9 * * *',
  automation_id: null,
  trigger_source: null,
  created_by: 'user_1',
  last_run_time: null,
});
vi.mock('@/lib/api', () => ({
  list_triggers: async () => [task('trg_on', 'enabled'), task('trg_off', 'disabled')],
  set_trigger_status,
  relative_time: () => 'just now',
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import {
  is_standalone_scheduled_task,
  ScheduledTaskRows,
} from '@/components/app/automations/scheduled_task_rows';
import type { Trigger } from '@/lib/api';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  set_trigger_status.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          'ul',
          null,
          createElement(ScheduledTaskRows, {
            search: '',
            showing: 'all',
            onPickKind: () => undefined,
          }),
        ),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flip(label: string) {
  const toggle = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!toggle) throw new Error(`no switch ${label}`);
  await act(async () => toggle.click());
}

it('turns a running task off and a stopped task on', async () => {
  await flip('Turn Task trg_on off');
  expect(set_trigger_status).toHaveBeenLastCalledWith('trg_on', 'disabled');
  await flip('Turn Task trg_off on');
  expect(set_trigger_status).toHaveBeenLastCalledWith('trg_off', 'enabled');
});

it("leaves Alfera's own scheduled work out of the person's list", () => {
  const with_source = (trigger_source: unknown) =>
    ({ ...task('trg_x', 'enabled'), trigger_source }) as unknown as Trigger;
  const heartbeat = { heartbeat: { every: '1h' } };

  expect(is_standalone_scheduled_task(with_source({ kind: 'system', ...heartbeat }))).toBe(false);
  expect(is_standalone_scheduled_task(with_source({ origin: 'system' }))).toBe(false);
  expect(is_standalone_scheduled_task(with_source({ origin: 'chat', ...heartbeat }))).toBe(true);
  expect(is_standalone_scheduled_task(with_source(null))).toBe(true);
});
