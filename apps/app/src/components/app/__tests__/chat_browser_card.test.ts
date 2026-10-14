// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBrowserLiveStream } from '@/components/app/browser_live_view/use_browser_live_stream';
import { ChatBrowserCard } from '@/components/app/chat_browser_card';
import { BrowserCardPreview } from '@/components/app/chat_browser_card_preview';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import type { SandboxUrlPreview } from '@/lib/api';

const preview: SandboxUrlPreview = {
  sandbox_url_preview_id: 'browser:1',
  runtime_environment_id: 'runtime:1',
  environment_provider: 'e2b',
  environment_status: 'running',
  preview_kind: 'browser_live_view',
  preview_name: 'Browser',
  preview_url: 'https://browser.example.test',
  preview_domain: 'browser.example.test',
  live_view_token: 'test-token',
  sandbox_key: 'sandbox:1',
  source: 'active',
  last_updated_time: '2026-09-09T00:00:00.000Z',
};

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
}

let root: Root;
let container: HTMLDivElement;
const draw_image = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 1440, height: 900, close: vi.fn() }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw_image,
  } as unknown as CanvasRenderingContext2D);
  TestSocket.instances = [];
  draw_image.mockClear();
  useChatUiStore.setState({ files_panel_open: false, files_panel_mode: 'files' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('paints real stream frames, shows activity, and opens the Browser sidebar', async () => {
  await act(async () => root.render(createElement(ChatBrowserCard, { preview })));
  const socket = TestSocket.instances[0];
  if (!socket) throw new Error('The browser socket did not open.');
  expect(container.textContent).toContain('Connecting to the browser');
  await act(async () => {
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'frame',
        data: 'eA==',
        metadata: { deviceWidth: 1440, deviceHeight: 900 },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(draw_image).toHaveBeenCalled();
  expect(container.querySelector('canvas')?.width).toBe(1440);
  expect(container.querySelector('canvas')?.height).toBe(900);
  expect(container.textContent).not.toContain('Connecting');
  expect(container.querySelector('p[title]')?.textContent).toBe('Live browser');

  await act(async () =>
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'command',
        action: 'navigate',
        params: { url: 'https://alfera.ai' },
      }),
    }),
  );
  expect(container.querySelector('p[title="Opening alfera.ai"]')?.textContent).toBe(
    'Opening alfera.ai',
  );
  await act(async () => container.querySelector('button')?.click());
  expect(useChatUiStore.getState().files_panel_mode).toBe('browser');
  expect(useChatUiStore.getState().files_panel_open).toBe(true);
  expect(TestSocket.instances).toHaveLength(1);

  await act(async () => socket.onclose?.());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Disconnected');
  expect(container.querySelector('canvas')).not.toBeNull();
  await act(async () => root.render(null));
  expect(socket.close).toHaveBeenCalled();
});

it('replaces the loading state when no browser frame arrives', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await act(async () => root.render(createElement(ChatBrowserCard, { preview })));
  const deadline = timers.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
  if (typeof deadline !== 'function') throw new Error('The first-frame deadline is missing.');
  await act(async () => deadline());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Disconnected');
  expect(container.textContent).toContain('Open the browser to reconnect.');
  expect(container.textContent).not.toContain('Connecting');
  expect(container.querySelector('button')?.disabled).toBe(false);
});

it('uses run state for Working, Done, Stopped, and Failed without reconnecting the stream', async () => {
  await act(async () =>
    root.render(createElement(ChatBrowserCard, { preview, run_status: 'running' })),
  );
  const socket = TestSocket.instances[0];
  if (!socket) throw new Error('The browser socket did not open.');
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Starting');
  await act(async () => {
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'frame',
        data: 'eA==',
        metadata: { deviceWidth: 1440, deviceHeight: 900 },
      }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: 'url', url: 'https://alfera.ai/contact' }) });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Working');
  expect(container.textContent).toContain('Working · alfera.ai');
  for (const run_status of ['queued', 'starting'] as const) {
    await act(async () => root.render(createElement(ChatBrowserCard, { preview, run_status })));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Working');
  }
  await act(async () =>
    root.render(createElement(ChatBrowserCard, { preview, run_status: 'waiting' })),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Waiting');
  await act(async () =>
    root.render(createElement(ChatBrowserCard, { preview, run_status: 'running' })),
  );
  expect(container.querySelector('.lucide-lock-keyhole')).not.toBeNull();
  await act(async () =>
    socket.onmessage?.({ data: JSON.stringify({ type: 'url', url: 'http://alfera.ai' }) }),
  );
  expect(container.querySelector('.lucide-lock-keyhole')).toBeNull();
  await act(async () =>
    socket.onmessage?.({
      data: JSON.stringify({ type: 'pointer', kind: 'down', x: 400, y: 300, name: 'Contact' }),
    }),
  );
  expect(container.querySelector('.lucide-mouse-pointer-2')).not.toBeNull();
  for (const [run_status, label] of [
    ['completed', 'Done'],
    ['cancelled', 'Stopped'],
    ['failed', 'Failed'],
    ['blocked', 'Blocked'],
    ['timed_out', 'Timed out'],
  ] as const) {
    await act(async () => root.render(createElement(ChatBrowserCard, { preview, run_status })));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(label);
    expect(container.querySelector('.lucide-mouse-pointer-2')).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
  }
  expect(TestSocket.instances).toHaveLength(1);
  await act(async () =>
    root.render(createElement(ChatBrowserCard, { preview, run_status: 'completed' })),
  );
  await act(async () => socket.onclose?.());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Done');
  expect(container.textContent).toContain('Preview disconnected');
});

it('keeps the card dimensions stable and never calls an idle browser Done', async () => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 900, height: 1440, close: vi.fn() }),
  );
  await act(async () => root.render(createElement(ChatBrowserCard, { preview })));
  const socket = TestSocket.instances[0];
  if (!socket) throw new Error('The browser socket did not open.');
  const stage = container.querySelector('.aspect-\\[16\\/10\\]');
  expect(stage).not.toBeNull();
  await act(async () => {
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'frame',
        data: 'eA==',
        metadata: { deviceWidth: 900, deviceHeight: 1440 },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Ready');
  expect(container.querySelector('.aspect-\\[16\\/10\\]')).toBe(stage);
  expect(container.querySelector('canvas')?.className).toContain('object-contain');
  expect(container.querySelector('canvas')?.className).toContain('motion-reduce:transition-none');
});

it('removes click animation for reduced motion while preserving the real cursor', async () => {
  function Preview({ reduce_motion }: { reduce_motion: boolean }) {
    const stream = useBrowserLiveStream(preview);
    return createElement(BrowserCardPreview, {
      stream,
      status: 'Working',
      hostname: 'alfera.ai',
      reduce_motion,
    });
  }
  await act(async () => root.render(createElement(Preview, { reduce_motion: true })));
  const socket = TestSocket.instances[0];
  if (!socket) throw new Error('The browser socket did not open.');
  await act(async () => {
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'frame',
        data: 'eA==',
        metadata: { deviceWidth: 1440, deviceHeight: 900 },
      }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: 'pointer', kind: 'down', x: 400, y: 300 }) });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(container.querySelector('.lucide-mouse-pointer-2')).not.toBeNull();
  expect(container.querySelector('[class*="border-sky-500"]')).toBeNull();
  await act(async () => root.render(createElement(Preview, { reduce_motion: false })));
  expect(container.querySelector('[class*="border-sky-500"]')).not.toBeNull();
  expect(TestSocket.instances).toHaveLength(1);
});
