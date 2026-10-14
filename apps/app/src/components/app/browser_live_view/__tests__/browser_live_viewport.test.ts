// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserLiveViewport } from '@/components/app/browser_live_view/browser_live_viewport';
import type { BrowserTask } from '@/components/app/browser_live_view/browser_task_controls';
import { cancel_run, type SandboxUrlPreview } from '@/lib/api';

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
  constructor() {
    TestSocket.instances.push(this);
  }
}
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
let root: Root;
let container: HTMLDivElement;
let socket: TestSocket;
let fetch_mock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', TestSocket);
  TestSocket.instances = [];
  fetch_mock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: { run_status: 'cancelled' } }));
  vi.stubGlobal('fetch', fetch_mock);
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'hasPointerCapture').mockReturnValue(false);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(
  task?: BrowserTask,
  on_retry?: () => void,
  take_control = task === undefined,
) {
  await act(async () =>
    root.render(
      createElement(BrowserLiveViewport, {
        preview,
        ...(task ? { browser_task: task } : {}),
        ...(on_retry ? { on_retry } : {}),
      }),
    ),
  );
  const current = TestSocket.instances.at(-1);
  if (!current) throw new Error('Missing socket');
  socket = current;
  await act(async () => socket.onopen?.());
  vi.spyOn(surface(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 360));
  if (take_control) await act(async () => button('Take control').click());
}
function surface() {
  const element = container.querySelector<HTMLElement>('[role="application"]');
  if (!element) throw new Error('Missing surface');
  return element;
}
function button(label: string) {
  const element = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label,
  );
  if (!element) throw new Error(`Missing ${label}`);
  return element;
}
function messages() {
  return socket.send.mock.calls.map(
    ([raw]) => JSON.parse(raw as string) as Record<string, unknown>,
  );
}
async function pointer(type: string, input: PointerEventInit = {}) {
  await act(async () =>
    surface().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse',
        clientX: 20,
        clientY: 30,
        ...input,
      }),
    ),
  );
}
async function key(type: string, input: KeyboardEventInit) {
  await act(async () =>
    surface().dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...input })),
  );
}

describe('real browser viewport input', () => {
  it('blocks every remote input path before control is granted', async () => {
    await render(undefined, undefined, false);
    await pointer('pointerdown');
    await pointer('pointerup');
    await act(async () =>
      surface().dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }),
      ),
    );
    await key('keydown', { key: 'a', code: 'KeyA', keyCode: 65 });
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'blocked');
    await act(async () =>
      surface().dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      ),
    );
    expect(button('Back').disabled).toBe(true);
    expect(button('New tab').disabled).toBe(true);
    expect(messages()).toEqual([]);
  });

  it('keeps the current single-tab address when an older URL event arrives', async () => {
    await render();
    const address = () =>
      container.querySelector<HTMLInputElement>('[aria-label="Address"]')?.value;
    await act(async () =>
      socket.onmessage?.({ data: JSON.stringify({ type: 'url', url: 'https://www.iana.org/' }) }),
    );
    expect(address()).toBe('iana.org');
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'tabs',
          tabs: [
            { tabId: 't1', active: true, title: 'Current page', url: 'http://127.0.0.1:8082/' },
          ],
        }),
      });
      socket.onmessage?.({ data: JSON.stringify({ type: 'url', url: 'https://www.iana.org/' }) });
    });
    expect(address()).toBe('127.0.0.1:8082');
    await act(async () =>
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'tabs',
          tabs: [{ tabId: 't1', active: true, title: 'Next page', url: 'https://example.org/' }],
        }),
      }),
    );
    expect(address()).toContain('example.org');
  });

  it('maps input to decoded frame dimensions and ignores newer metadata until paint', async () => {
    fetch_mock.mockImplementation(async () => Response.json({}));
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    const decode = vi.fn().mockResolvedValue({ width: 1280, height: 577, close: vi.fn() });
    vi.stubGlobal('createImageBitmap', decode);
    await render();
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'frame',
          data: 'eA==',
          metadata: { deviceWidth: 1280, deviceHeight: 720 },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    const canvas = container.querySelector('canvas');
    expect([canvas?.width, canvas?.height]).toEqual([1280, 577]);
    expect(surface().style.aspectRatio).toBe('1280 / 577');
    await pointer('pointerdown', { clientX: 320, clientY: 180 });
    await pointer('pointerup', { clientX: 320, clientY: 180 });
    expect(messages().at(-1)).toMatchObject({ x: 640, y: 289 });

    let finish:
      | ((bitmap: { width: number; height: number; close: () => void }) => void)
      | undefined;
    decode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'frame',
          data: 'eA==',
          metadata: { deviceWidth: 1280, deviceHeight: 900 },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await pointer('pointerdown', { clientX: 320, clientY: 180 });
    await pointer('pointerup', { clientX: 320, clientY: 180 });
    expect(messages().at(-1)).toMatchObject({ x: 640, y: 289 });
    await act(async () => {
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      finish?.({ width: 1280, height: 600, close: vi.fn() });
    });
    expect([canvas?.width, canvas?.height]).toEqual([1280, 600]);
    await pointer('pointerdown', { clientX: 320, clientY: 180 });
    expect(messages().at(-1)).toMatchObject({ x: 640, y: 300 });
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('uses the fallback image natural size rather than stream metadata', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1280;
        naturalHeight = 577;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    await render();
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'frame',
          data: 'eA==',
          metadata: { deviceWidth: 1280, deviceHeight: 720 },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.querySelector('canvas')?.height).toBe(577);
    await pointer('pointerdown', { clientX: 320, clientY: 180 });
    expect(messages().at(-1)).toMatchObject({ x: 640, y: 289 });
  });

  it('shows upstream failure, keeps idle frames live, and recovers on a new frame', async () => {
    const retry = vi.fn();
    fetch_mock.mockImplementation(async () => Response.json({}));
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 1280, height: 720, close: vi.fn() }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    await render(undefined, retry);
    const frame = {
      type: 'frame',
      data: 'eA==',
      metadata: { deviceWidth: 1280, deviceHeight: 720 },
    };
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify(frame) });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    expect(container.textContent).not.toContain('disconnected');
    vi.useRealTimers();
    await act(async () =>
      socket.onmessage?.({
        data: JSON.stringify({ type: 'status', connected: false, screencasting: false }),
      }),
    );
    expect(container.textContent).toContain('The browser disconnected');
    expect(button('Retry browser')).toBeTruthy();
    expect(socket.close).not.toHaveBeenCalled();
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify(frame) });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.textContent).toContain('The browser disconnected');
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ type: 'status', connected: true, screencasting: false }),
      });
      socket.onmessage?.({ data: JSON.stringify(frame) });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.querySelector('canvas')?.style.opacity).toBe('0');
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ type: 'status', connected: true, screencasting: true }),
      });
      socket.onmessage?.({ data: JSON.stringify(frame) });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.textContent).not.toContain('disconnected');
    expect(container.querySelector('canvas')?.style.opacity).toBe('1');
  });

  it('forwards Shift-click, Ctrl-click, and wheel modifiers to the remote browser', async () => {
    await render();
    await pointer('pointerdown', { shiftKey: true });
    await pointer('pointerup', { shiftKey: true });
    expect(messages().at(-1)).toMatchObject({ eventType: 'mouseReleased', modifiers: 8 });
    await pointer('pointerdown', { ctrlKey: true });
    await pointer('pointerup', { ctrlKey: true });
    expect(messages().at(-1)).toMatchObject({ eventType: 'mouseReleased', modifiers: 2 });
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 10,
      shiftKey: true,
    });
    Object.defineProperty(event, 'shiftKey', { value: true });
    await act(async () => surface().dispatchEvent(event));
    expect(messages().at(-1)).toMatchObject({ eventType: 'mouseWheel', modifiers: 8 });
  });

  it('focuses pointer input and forwards right clicks, double clicks, and cancelled releases', async () => {
    await render();
    await pointer('pointerdown', { button: 2 });
    await pointer('pointerup', { button: 2 });
    expect(document.activeElement).toBe(surface());
    expect(messages()).toContainEqual(
      expect.objectContaining({ eventType: 'mousePressed', button: 'right', clickCount: 1 }),
    );
    await pointer('pointerdown');
    await pointer('pointerup');
    await pointer('pointerdown');
    await pointer('pointercancel');
    expect(messages()).toContainEqual(
      expect.objectContaining({ eventType: 'mousePressed', button: 'left', clickCount: 2 }),
    );
    expect(messages().at(-1)).toMatchObject({ eventType: 'mouseReleased', button: 'left' });
  });
  it('sends a touch pan as wheel input without clicking the page', async () => {
    await render();
    await pointer('pointerdown', { pointerType: 'touch' });
    await pointer('pointermove', { pointerType: 'touch', clientY: 10 });
    await pointer('pointerup', { pointerType: 'touch', clientY: 10 });
    expect(messages()).toContainEqual(
      expect.objectContaining({ eventType: 'mouseWheel', deltaY: 40 }),
    );
    expect(messages().some((item) => item.eventType === 'mousePressed')).toBe(false);
    await pointer('pointerdown', { pointerType: 'touch' });
    await pointer('pointerup', { pointerType: 'touch' });
    expect(messages()).toContainEqual(expect.objectContaining({ eventType: 'mousePressed' }));
  });
  it('normalizes wheel lines and stops local scrolling', async () => {
    await render();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: 1,
      deltaY: 3,
    });
    await act(async () => surface().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(messages().at(-1)).toMatchObject({ eventType: 'mouseWheel', deltaY: 48 });
  });
  it('releases held input and control when Escape exits', async () => {
    await render();
    surface().focus();
    await key('keydown', { key: 'a', code: 'KeyA', keyCode: 65 });
    await key('keyup', { key: 'a', code: 'KeyA', keyCode: 65 });
    await key('keydown', { key: 'a', code: 'KeyA', metaKey: true });
    await key('keydown', { key: 'Tab', code: 'Tab', keyCode: 9 });
    expect(messages().filter((item) => item.eventType === 'char')).toEqual([]);
    expect(messages()).toContainEqual({
      type: 'input_keyboard',
      eventType: 'keyDown',
      key: 'a',
      code: 'KeyA',
      text: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 0,
    });
    expect(messages()).toContainEqual({
      type: 'input_keyboard',
      eventType: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      text: '\t',
      windowsVirtualKeyCode: 9,
      modifiers: 0,
    });
    expect(messages()).toContainEqual(
      expect.objectContaining({ eventType: 'keyDown', key: 'a', modifiers: 2 }),
    );
    await pointer('pointerdown', { clientX: 40, clientY: 50 });
    const outer_escape = vi.fn();
    document.body.addEventListener('keydown', outer_escape);
    await key('keydown', { key: 'Escape', code: 'Escape' });
    expect(surface().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button('Take control'));
    expect(messages()).toContainEqual(expect.objectContaining({ eventType: 'keyUp', key: 'Tab' }));
    expect(messages()).toContainEqual(
      expect.objectContaining({ eventType: 'mouseReleased', x: 80, y: 100 }),
    );
    expect(messages()).not.toContainEqual(
      expect.objectContaining({ eventType: 'keyDown', key: 'Escape' }),
    );
    expect(outer_escape).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outer_escape);
    socket.send.mockClear();
    await pointer('pointerdown');
    expect(messages()).toEqual([]);
    await act(async () => button('Take control').click());
    await pointer('pointerdown');
    expect(messages()).toContainEqual(expect.objectContaining({ eventType: 'mousePressed' }));
  });

  it('releases control from the address bar without closing the outer panel', async () => {
    await render();
    const address = container.querySelector<HTMLInputElement>('[aria-label="Address"]');
    if (!address) throw new Error('Missing address');
    address.focus();
    const outer_escape = vi.fn();
    document.body.addEventListener('keydown', outer_escape);
    await act(async () =>
      address.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
      ),
    );
    expect(address.disabled).toBe(true);
    expect(document.activeElement).toBe(button('Take control'));
    expect(outer_escape).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outer_escape);
  });
  it('inserts native text input for touch keyboards through the real socket', async () => {
    await render();
    await act(async () => button('Type in browser').click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="Text for browser"]');
    if (!input) throw new Error('Missing text input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'Rachel 日本語',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      input
        .closest('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(messages().filter((message) => message.eventType === 'char')).toEqual(
      [...'Rachel 日本語'].map((character) => ({
        type: 'input_keyboard',
        eventType: 'char',
        key: '',
        code: '',
        text: character,
        windowsVirtualKeyCode: 0,
        modifiers: 0,
      })),
    );
    expect(input.value).toBe('');
  });
  it('pastes Unicode text as complete character events in order', async () => {
    await render();
    const clipboard = new DataTransfer();
    const text = ' — café 東京 👋';
    clipboard.setData('text/plain', text);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    await act(async () => surface().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(messages()).toEqual(
      [...text].map((character) => ({
        type: 'input_keyboard',
        eventType: 'char',
        key: '',
        code: '',
        text: character,
        windowsVirtualKeyCode: 0,
        modifiers: 0,
      })),
    );
  });

  it('restores keyboard focus after the focused tab close button disappears', async () => {
    await render();
    const first = { tabId: 'a', title: 'First', url: 'https://a.test', active: false };
    const second = { tabId: 'b', title: 'Second', url: 'https://b.test', active: true };
    await act(async () =>
      socket.onmessage?.({ data: JSON.stringify({ type: 'tabs', tabs: [first, second] }) }),
    );
    const close = button('Close Second');
    close.focus();
    await act(async () => close.click());
    expect(messages()).toContainEqual(
      expect.objectContaining({ type: 'control', action: 'tab_close', tab_id: 'b' }),
    );
    await act(async () =>
      socket.onmessage?.({
        data: JSON.stringify({ type: 'tabs', tabs: [{ ...first, active: true }] }),
      }),
    );
    expect(document.activeElement).toBe(container.querySelector('[role="tab"][data-tab-id="a"]'));
  });

  it('moves tab focus with arrows and sends the real switch command', async () => {
    await render();
    await act(async () =>
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'tabs',
          tabs: [
            { tabId: 'a', title: 'First', url: 'https://a.test', active: true },
            { tabId: 'b', title: 'Second', url: 'https://b.test', active: false },
          ],
        }),
      }),
    );
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs[0]?.focus();
    await act(async () =>
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })),
    );
    expect(document.activeElement).toBe(tabs[1]);
    expect(messages()).toContainEqual(
      expect.objectContaining({ type: 'control', action: 'tab_switch', tab_id: 'b' }),
    );
  });
});

describe('browser task controls', () => {
  it('waits for the cancellation endpoint, prevents duplicate clicks, then focuses the page', async () => {
    let finish: ((value: Response) => void) | undefined;
    fetch_mock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const task = {
      run_id: 'run:1',
      is_active: true,
      stop: async () => (await cancel_run('run:1')).run_status === 'cancelled',
    };
    await render(task);
    await act(async () => {
      button('Take control').click();
      button('Stop task').click();
    });
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    expect(String(fetch_mock.mock.calls[0]?.[0])).toContain('/v1/runs/run:1/cancel');
    expect(document.activeElement).not.toBe(surface());
    expect(container.textContent).toContain('Stopping task…');
    await pointer('pointerdown');
    await pointer('pointerup');
    expect(messages()).toEqual([]);
    await act(async () => finish?.(Response.json({ data: { run_status: 'cancelled' } })));
    await render({ ...task, is_active: false });
    expect(document.activeElement).toBe(surface());
    expect(container.textContent).toContain('Give back control');
    await pointer('pointerdown');
    await pointer('pointerup');
    expect(messages()).toContainEqual(expect.objectContaining({ eventType: 'mousePressed' }));
  });

  it('gives control back and keeps the stopped browser view-only', async () => {
    await render({ run_id: 'run:1', is_active: false, stop: async () => true });
    await act(async () => button('Take control').click());
    expect(container.textContent).toContain('The task remains stopped');
    await act(async () => button('Give back control').click());
    expect(surface().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button('Take control'));
    expect(container.textContent).toContain('The browser stays open for you');
    await pointer('pointerdown');
    expect(messages()).toEqual([]);
  });
  it('shows cancellation failure and keeps the controls available for retry', async () => {
    fetch_mock.mockResolvedValue(
      Response.json({ error: { message: 'Cancellation unavailable' } }, { status: 503 }),
    );
    await render({
      run_id: 'run:1',
      is_active: true,
      stop: async () => {
        await cancel_run('run:1');
        return true;
      },
    });
    await act(async () => button('Stop task').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Cancellation unavailable',
    );
    expect(button('Stop task').disabled).toBe(false);
  });
  it('does not claim control when startup has no cancellable run', async () => {
    await render({ run_id: 'pending', is_active: true, stop: async () => false });
    await act(async () => button('Take control').click());
    expect(container.textContent).toContain('The task did not stop');
    expect(container.textContent).not.toContain('Give back control');
    await pointer('pointerdown');
    expect(messages()).toEqual([]);
  });

  it('keeps input locked when the task stops without granting control', async () => {
    const task = { run_id: 'run:1', is_active: true, stop: async () => true };
    await render(task);
    await act(async () => button('Stop task').click());
    await render({ ...task, is_active: false });
    await pointer('pointerdown');
    await pointer('pointerup');
    expect(messages()).toEqual([]);
  });

  it('resets control when a new run owns the browser', async () => {
    const task = { run_id: 'run:old', is_active: false, stop: async () => true };
    await render(task);
    await act(async () => button('Take control').click());
    await pointer('pointerdown');
    expect(messages()).not.toEqual([]);
    socket.send.mockClear();
    await render({ ...task, run_id: 'run:new' });
    await pointer('pointerdown');
    expect(messages()).toEqual([]);
  });
  it('does not focus a new run after an old cancellation completes', async () => {
    let finish: ((value: boolean) => void) | undefined;
    await render({
      run_id: 'run:old',
      is_active: true,
      stop: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await act(async () => button('Take control').click());
    await render({ run_id: 'run:new', is_active: true, stop: async () => true });
    await act(async () => finish?.(true));
    expect(document.activeElement).not.toBe(surface());
    expect(container.textContent).not.toContain('Give back control');
  });
});
