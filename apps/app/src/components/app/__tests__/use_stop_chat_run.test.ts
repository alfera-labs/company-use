// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStopChatRun } from '@/components/app/use_stop_chat_run';
import type { Run } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let stop: () => Promise<boolean>;
let fetch_mock: ReturnType<typeof vi.fn<typeof fetch>>;
const controller_ref: RefObject<AbortController | null> = { current: null };
const session_ref: RefObject<string | undefined> = { current: undefined };
const run = { run_id: 'run:1', session_id: 'session:1', run_status: 'running' };
function Controls({
  active_run,
  is_submitting,
}: {
  active_run: typeof run | undefined;
  is_submitting: boolean;
}) {
  stop = useStopChatRun({
    session_id: active_run?.session_id ?? run.session_id,
    run: active_run,
    is_submitting,
    stream_abort_ref: controller_ref,
    stream_session_id_ref: session_ref,
  });
  return null;
}
async function render(active_run: typeof run | undefined = run, is_submitting = true) {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Controls, { active_run, is_submitting }),
      ),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetch_mock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: { ...run, run_status: 'cancelled' } }));
  vi.stubGlobal('fetch', fetch_mock);
  client = new QueryClient();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  controller_ref.current = new AbortController();
  session_ref.current = run.session_id;
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe('the shared chat stop operation', () => {
  it('waits for the run of a message that is still starting, then stops that run', async () => {
    const runs_the_api_lists = [[{ ...run, run_id: 'run:0', run_status: 'completed' }], [run]];
    fetch_mock.mockImplementation(async (input, init) =>
      new Request(input, init).method === 'GET'
        ? Response.json({ data: runs_the_api_lists.shift() ?? [run] })
        : Response.json({ data: { ...run, run_status: 'cancelled' } }),
    );
    await render({ ...run, run_id: 'run:0', run_status: 'completed' });
    const controller = controller_ref.current;
    expect(await stop()).toBe(true);
    const stop_request = fetch_mock.mock.calls
      .map(([input, init]) => new Request(input, init))
      .find((request) => request.method === 'POST');
    expect(stop_request?.url).toContain(`/v1/runs/${run.run_id}/cancel`);
    expect(controller?.signal.aborted).toBe(true);
    expect(client.getQueryData<Run[]>(query_keys.runs(run.session_id))?.[0]?.run_status).toBe(
      'cancelled',
    );
  });
  it('does nothing when no run works and no message waits to start', async () => {
    await render({ ...run, run_status: 'completed' }, false);
    expect(await stop()).toBe(true);
    expect(fetch_mock).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent requests and preserves a new chat stream during cancellation', async () => {
    let finish: ((value: Response) => void) | undefined;
    fetch_mock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    const original = controller_ref.current;
    const first = stop();
    const second = stop();
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    const next = new AbortController();
    controller_ref.current = next;
    session_ref.current = 'session:2';
    await render({ ...run, run_id: 'run:2', session_id: 'session:2' });
    finish?.(Response.json({ data: { ...run, run_status: 'cancelled' } }));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(original?.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    expect(controller_ref.current).toBe(next);
  });
  it('keeps each pending cancellation when switching A to B to A', async () => {
    const finish: Array<(response: Response) => void> = [];
    fetch_mock.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    await render(run);
    const first = stop();
    const second_run = { ...run, run_id: 'run:2', session_id: 'session:2' };
    await render(second_run);
    const second = stop();
    await render(run);
    const repeated_first = stop();
    expect(fetch_mock).toHaveBeenCalledTimes(2);
    finish[0]?.(Response.json({ data: { ...run, run_status: 'cancelled' } }));
    finish[1]?.(Response.json({ data: { ...second_run, run_status: 'cancelled' } }));
    expect(await Promise.all([first, second, repeated_first])).toEqual([true, true, true]);
    expect(client.getQueryData<Run[]>(query_keys.runs(run.session_id))?.[0]?.run_status).toBe(
      'cancelled',
    );
    expect(
      client.getQueryData<Run[]>(query_keys.runs(second_run.session_id))?.[0]?.run_status,
    ).toBe('cancelled');
  });

  it('does not abort a different session stream', async () => {
    session_ref.current = 'session:other';
    await render();
    const controller = controller_ref.current;
    expect(await stop()).toBe(true);
    expect(controller?.signal.aborted).toBe(false);
  });
  it('keeps the stream on failure and sends a fresh retry', async () => {
    fetch_mock.mockResolvedValueOnce(
      Response.json({ error: { message: 'Unavailable' } }, { status: 503 }),
    );
    await render();
    const controller = controller_ref.current;
    expect(await stop()).toBe(false);
    expect(controller?.signal.aborted).toBe(false);
    expect(await stop()).toBe(true);
    expect(fetch_mock).toHaveBeenCalledTimes(2);
  });
  it('does not report success when the endpoint still reports an active task', async () => {
    fetch_mock.mockResolvedValue(Response.json({ data: run }));
    await render();
    const controller = controller_ref.current;
    expect(await stop()).toBe(false);
    expect(controller?.signal.aborted).toBe(false);
  });
});
