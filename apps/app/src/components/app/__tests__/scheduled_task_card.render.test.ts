// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduledTasksGrid } from '@/components/app/scheduled_tasks_page';
import type { Trigger } from '@/lib/api';
import { team_viewer_role_query_key } from '@/lib/api/team_mode';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

const task = {
  trigger_id: 'trg_1',
  trigger_name: 'Morning digest',
  trigger_type: 'schedule',
  trigger_status: 'enabled',
  schedule_expression: '0 9 * * *',
  trigger_config: { job_input: { instruction: 'Post a digest.' }, timezone: 'Europe/Rome' },
  created_by: 'user_1',
  last_run_time: null,
  next_run_time: null,
} as Trigger;

let root: Root | null = null;
let asked_paths: string[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  asked_paths = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    asked_paths.push(new URL(new Request(input).url).pathname);
    const dana = { user_id: 'user_1', first_name: 'Dana', last_name: 'Reyes' };
    return Response.json({ data: { viewer_user_id: 'user_2', members: [dana] } });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function card_text_for(team_role?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (team_role) client.setQueryData(team_viewer_role_query_key, team_role);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const no_action = () => {};
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScheduledTasksGrid, {
          tasks: [task],
          isError: false,
          isLoading: false,
          pendingStatusId: null,
          deletingId: null,
          runningId: null,
          searchQuery: '',
          onClearSearch: no_action,
          onToggleStatus: no_action,
          onDelete: no_action,
          onRun: no_action,
          onRetry: no_action,
        }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return container.querySelector('article')?.textContent ?? '';
}

it('shows the time of a task on a 24-hour clock, with its time zone', async () => {
  expect(await card_text_for()).toContain('Every day at 9:00 · Europe/Rome');
});

it.each(['owner', 'admin'])('shows an %s who made each task', async (team_role) => {
  expect(await card_text_for(team_role)).toContain('Made by Dana Reyes');
});

it('asks nothing about the team for a member, or on an install with no team', async () => {
  expect(await card_text_for('member')).not.toContain('Made by');
  act(() => root?.unmount());
  expect(await card_text_for()).not.toContain('Made by');

  expect(asked_paths.filter((path) => path.endsWith('/v1/team'))).toEqual([]);
});
