// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  last_run_words,
  use_newest_scheduled_task_run,
} from '@/components/app/scheduled_task_newest_run';
import { list_sessions, list_triggers, type TriggerRunHistoryItem } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const run_one: TriggerRunHistoryItem = {
  run_id: 'run_1',
  session_id: 'ses_1',
  run_number: 1,
  run_status: 'running',
  error_message: null,
  started_time: null,
  finished_time: null,
  created_time: new Date().toISOString(),
  is_unread: false,
};

let root: Root | null = null;
let client: QueryClient;
let runs_of_the_task: TriggerRunHistoryItem[];
let time_the_task_last_fired: string | null;
let the_runs_can_be_read: Promise<void>;
let reads: string[];

function TaskStatusLine() {
  const tasks = useQuery({ queryKey: query_keys.triggers(), queryFn: list_triggers }).data;
  useQuery({ queryKey: query_keys.sessions(), queryFn: list_sessions });
  const newest_run = use_newest_scheduled_task_run('trg_1');
  return last_run_words(tasks?.[0]?.last_run_time, newest_run);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  runs_of_the_task = [];
  time_the_task_last_fired = null;
  the_runs_can_be_read = Promise.resolve();
  reads = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(new Request(input, init).url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    reads.push(path);
    if (path.endsWith('/v1/triggers')) {
      return Response.json({
        data: [{ trigger_id: 'trg_1', last_run_time: time_the_task_last_fired }],
      });
    }
    if (!path.endsWith('/runs')) return Response.json({ data: [] });
    await the_runs_can_be_read;
    const page = { items: runs_of_the_task, total_count: 1, page: 1, page_size: 20 };
    return Response.json({ data: page });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function the_runs_are_read_again() {
  reads = [];
  await act(() => client.invalidateQueries({ queryKey: query_keys.trigger_runs('trg_1') }));
  await settle();
}

const lists_read_again = () => reads.filter((path) => !path.endsWith('/runs')).sort();

describe('the page of a scheduled task after "Run now"', () => {
  it('says the task runs, then when it last ran, and reads the tasks and the chats again each time', async () => {
    act(() =>
      root?.render(createElement(QueryClientProvider, { client }, createElement(TaskStatusLine))),
    );
    await settle();
    expect(document.body.textContent).toBe('No runs yet');

    runs_of_the_task = [run_one];
    await the_runs_are_read_again();
    expect(document.body.textContent).toBe('Running now');
    expect(lists_read_again()).toEqual(['/v1/sessions', '/v1/triggers']);

    runs_of_the_task = [
      { ...run_one, run_status: 'completed', finished_time: new Date().toISOString() },
    ];
    await the_runs_are_read_again();
    expect(document.body.textContent).toMatch(/^Last ran /u);
    expect(lists_read_again()).toEqual(['/v1/sessions', '/v1/triggers']);
  });

  it('reads nothing again while the newest run stays as it is', async () => {
    runs_of_the_task = [{ ...run_one, run_status: 'completed' }];
    act(() =>
      root?.render(createElement(QueryClientProvider, { client }, createElement(TaskStatusLine))),
    );
    await settle();

    await the_runs_are_read_again();

    expect(lists_read_again()).toEqual([]);
  });
});

const seconds_ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

async function the_tasks_and_the_runs_are_read_again() {
  await act(() => client.invalidateQueries({ queryKey: query_keys.triggers() }));
  await the_runs_are_read_again();
}

describe('when the page of a scheduled task says "Last ran"', () => {
  it('never says it for a run that was asked for and has not ended', async () => {
    act(() =>
      root?.render(createElement(QueryClientProvider, { client }, createElement(TaskStatusLine))),
    );
    await settle();
    const words_seen = [document.body.textContent];

    time_the_task_last_fired = seconds_ago(1);
    await the_tasks_and_the_runs_are_read_again();
    words_seen.push(document.body.textContent);

    runs_of_the_task = [run_one];
    await the_tasks_and_the_runs_are_read_again();
    words_seen.push(document.body.textContent);

    runs_of_the_task = [{ ...run_one, run_status: 'completed', finished_time: seconds_ago(1) }];
    await the_tasks_and_the_runs_are_read_again();
    words_seen.push(document.body.textContent);

    expect(words_seen).toEqual(['No runs yet', 'No runs yet', 'Running now', 'Last ran 1s ago']);
  });

  it('keeps the end of the run before while the next run is asked for and runs', async () => {
    const run_before = {
      ...run_one,
      run_status: 'completed',
      finished_time: seconds_ago(3 * 60 * 60),
    };
    time_the_task_last_fired = seconds_ago(3 * 60 * 60 + 20);
    runs_of_the_task = [run_before];
    act(() =>
      root?.render(createElement(QueryClientProvider, { client }, createElement(TaskStatusLine))),
    );
    await settle();
    const words_seen = [document.body.textContent];

    time_the_task_last_fired = seconds_ago(1);
    await the_tasks_and_the_runs_are_read_again();
    words_seen.push(document.body.textContent);

    runs_of_the_task = [{ ...run_one, run_id: 'run_2', run_number: 2 }, run_before];
    await the_tasks_and_the_runs_are_read_again();
    words_seen.push(document.body.textContent);

    expect(words_seen).toEqual(['Last ran 3h ago', 'Last ran 3h ago', 'Running now']);
  });

  it('says nothing about a task that fired until its runs are read, then that it runs', async () => {
    let let_the_runs_be_read = () => {};
    the_runs_can_be_read = new Promise((resolve) => {
      let_the_runs_be_read = resolve;
    });
    time_the_task_last_fired = seconds_ago(2);
    runs_of_the_task = [run_one];
    act(() =>
      root?.render(createElement(QueryClientProvider, { client }, createElement(TaskStatusLine))),
    );
    await settle();
    expect(document.body.textContent).toBe('');

    let_the_runs_be_read();
    await settle();
    expect(document.body.textContent).toBe('Running now');
  });

  it('says a task that never fired has no runs, before its runs are read', () => {
    expect(last_run_words(null, undefined)).toBe('No runs yet');
  });
});
