// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskDetails } from '@/components/app/scheduled_task_details';
import type { Trigger } from '@/lib/api';

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [] })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function scheduled_task_with(trigger_config: Trigger['trigger_config']): Trigger {
  return {
    trigger_id: 'trg_morning_plan',
    workspace_id: 'ws_test',
    agent_id: 'agent_main',
    node_id: null,
    automation_id: null,
    trigger_name: 'Morning plan',
    trigger_type: 'schedule',
    trigger_status: 'enabled',
    trigger_config,
    trigger_source: {},
    trigger_target: {},
    schedule_expression: '0 9 * * 1-5',
    next_run_time: null,
    last_run_time: null,
    metadata: {},
    created_time: '2026-01-12T12:00:00.000Z',
    last_updated_time: '2026-01-12T12:00:00.000Z',
    created_by: 'user_test',
    last_updated_by: 'user_test',
    run_count: 0,
  };
}

function read_detail_rows(trigger_config: Trigger['trigger_config']) {
  const task = scheduled_task_with(trigger_config);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ScheduledTaskDetails, { task, edit: null }),
      ),
    ),
  );
  const labels = [...document.querySelectorAll('dt')].map((label) => label.textContent);
  const values = [...document.querySelectorAll('dd')].map((value) => value.textContent);
  return Object.fromEntries(labels.map((label, index) => [label, values[index]]));
}

describe('the details of a scheduled task', () => {
  it('show the time zone the task runs in', () => {
    const rows = read_detail_rows({
      timezone: 'Asia/Tokyo',
      job_input: { instruction: 'Write the plan for the day.' },
    });

    expect(rows['Time zone']).toBe('Asia/Tokyo');
    expect(Object.keys(rows).slice(0, 2)).toEqual(['Schedule', 'Time zone']);
  });

  it('show no time zone row for a task that has none', () => {
    const rows = read_detail_rows({ job_input: { instruction: 'Write the plan for the day.' } });

    expect(Object.keys(rows)).not.toContain('Time zone');
  });
});
