// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { WorkspaceBrowserLiveView } from '@/components/app/workspace_browser_live_view';
import { file_draft_key, use_file_drafts } from '@/components/app/workspace_documents/file_drafts';
import { WorkspaceFilesPanel } from '@/components/app/workspace_files_panel';
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
let client: QueryClient;
let fetch_mock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  use_file_drafts.setState({ drafts: {}, tabs: {}, generations: {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', TestSocket);
  TestSocket.instances = [];
  fetch_mock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ data: preview }));
  vi.stubGlobal('fetch', fetch_mock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  document.querySelector('[data-test-panel-opener]')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(session_id: string | undefined) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorkspaceBrowserLiveView, { session_id }),
      ),
    );
  });
}

async function settle(assertion: () => void) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assertion();
}

describe('the sidebar browser lifecycle', () => {
  it.each([
    {
      failure: 'conflict',
      status: 409,
      message: 'The file changed.',
      expected: 'Someone changed this file.',
    },
    {
      failure: 'server error',
      status: 500,
      message: 'Storage is unavailable.',
      expected: 'Storage is unavailable.',
    },
    {
      failure: 'network error',
      status: null,
      message: 'The connection failed.',
      expected: 'The connection failed.',
    },
  ])('preserves edited text across panel changes and a $failure save', async ({
    status,
    message,
    expected,
  }) => {
    const file_path = 'files/notes.txt';
    useChatUiStore.setState({
      files_panel_mode: 'files',
      files_panel_requested_file_path: file_path,
    });
    fetch_mock.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') {
        if (status === null) throw new TypeError(message);
        return Response.json(
          {
            error: {
              code: status === 409 ? 'workspace_file_conflict' : 'storage_unavailable',
              message,
            },
          },
          { status },
        );
      }
      if (String(url).includes('/files/content'))
        return Response.json({
          data: {
            file_path,
            content_text: 'Original text',
            content_kind: 'text',
            content_version: 'a'.repeat(64),
            may_edit: true,
            byte_size: 13,
          },
        });
      return Response.json({
        data: String(url).endsWith('/browser/start')
          ? preview
          : { volume_ready: true, files: [], folders: [], folder_path: '' },
      });
    });
    const present = async (is_open: boolean) =>
      act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(WorkspaceFilesPanel, {
              workspace_id: 'workspace_test',
              session_id: 'session:files',
              sandboxPreviews: [],
              onClose: () => {},
              is_open,
            }),
          ),
        ),
      );
    const click_button = async (label: string) =>
      act(async () =>
        Array.from(container.querySelectorAll('button'))
          .find((button) => button.textContent === label)
          ?.click(),
      );
    await present(true);
    await settle(() => expect(container.textContent).toContain('Original text'));
    await click_button('Edit');
    await act(async () => {
      const textarea = container.querySelector('textarea');
      if (!textarea) throw new Error('The source editor did not open.');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        textarea,
        'My unsaved text',
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(() =>
      expect(
        use_file_drafts.getState().drafts[file_draft_key('workspace_test', file_path)]?.text,
      ).toBe('My unsaved text'),
    );
    await click_button('browser');
    await click_button('files');
    await present(false);
    await present(true);
    expect(container.querySelector('textarea')?.value).toBe('My unsaved text');
    await click_button('Save');
    await settle(() => expect(container.textContent).toContain(expected));
    expect(container.querySelector('textarea')?.value).toBe('My unsaved text');
    expect(container.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Download draft',
      ),
    ).toBe(true);
    expect(
      use_file_drafts.getState().drafts[file_draft_key('workspace_test', file_path)]?.dirty,
    ).toBe(true);
    const save_request = fetch_mock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(save_request?.[1]?.body))).toMatchObject({
      expected_version: 'a'.repeat(64),
      content_text: 'My unsaved text',
    });
    expect(
      use_file_drafts.getState().drafts[file_draft_key('another_workspace', file_path)],
    ).toBeUndefined();
  });

  it('starts from the Browser tab and closes the socket when Files opens', async () => {
    useChatUiStore.setState({ files_panel_mode: 'files', files_panel_requested_file_path: null });
    fetch_mock.mockImplementation(async (url) =>
      Response.json({
        data: String(url).endsWith('/browser/start')
          ? preview
          : { files: [], folders: [], folder_path: '' },
      }),
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WorkspaceFilesPanel, {
            workspace_id: 'workspace_test',
            session_id: 'session:1',
            sandboxPreviews: [],
            onClose: () => {},
          }),
        ),
      ),
    );
    expect(fetch_mock.mock.calls.some(([url]) => String(url).endsWith('/browser/start'))).toBe(
      false,
    );
    const mode_button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === text,
      );
    await act(async () => mode_button('browser')?.click());
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    await act(async () => mode_button('files')?.click());
    expect(TestSocket.instances[0]?.close).toHaveBeenCalled();
  });

  it('uses one modal browser on small screens and preserves its stream on desktop', async () => {
    const opener = document.createElement('button');
    opener.dataset.testPanelOpener = 'true';
    document.body.append(opener);
    opener.focus();
    let compact = true;
    const media = window.matchMedia('(max-width: 1279px)');
    Object.defineProperty(media, 'matches', { get: () => compact });
    const native_match_media = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query === '(max-width: 1279px)' ? media : native_match_media(query),
    );
    const show_modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const on_close = vi.fn();
    useChatUiStore.setState({ files_panel_mode: 'browser', files_panel_requested_file_path: null });
    fetch_mock.mockImplementation(async (url) =>
      Response.json({
        data: String(url).endsWith('/browser/start')
          ? preview
          : { files: [], folders: [], folder_path: '' },
      }),
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WorkspaceFilesPanel, {
            workspace_id: 'workspace_test',
            session_id: 'session:mobile',
            sandboxPreviews: [],
            onClose: on_close,
          }),
        ),
      ),
    );
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const dialog = container.querySelector('dialog');
    expect(show_modal).toHaveBeenCalledTimes(1);
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('role')).toBe('dialog');
    await act(async () => {
      compact = false;
      media.dispatchEvent(new Event('change'));
    });
    expect(dialog?.getAttribute('role')).toBe('complementary');
    expect(TestSocket.instances).toHaveLength(1);
    expect(TestSocket.instances[0]?.close).not.toHaveBeenCalled();
    await act(async () =>
      dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })),
    );
    expect(on_close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('starts only with a chat and stays loading until a frame paints', async () => {
    await render(undefined);
    expect(fetch_mock).not.toHaveBeenCalled();
    await render('session:1');
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const request = fetch_mock.mock.calls[0];
    expect(String(request?.[0])).toContain('/v1/sessions/session:1/browser/start');
    expect(request?.[1]?.method).toBe('POST');
    const socket = TestSocket.instances[0];
    if (!socket) throw new Error('The browser socket did not open.');
    await act(async () => socket.onopen?.());
    expect(container.textContent).toContain('Connecting to the live browser');

    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 1280, height: 720, close: vi.fn() }),
    );
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
    expect(draw).toHaveBeenCalled();
    expect(container.textContent).not.toContain('Connecting to the live browser');
    await act(async () => socket.onclose?.());
    expect(container.textContent).toContain('The browser disconnected');
    expect(container.textContent).toContain('Retry browser');
  });

  it('shows startup errors and retries the real request', async () => {
    fetch_mock.mockResolvedValueOnce(
      Response.json({ error: { message: 'Provider unavailable' } }, { status: 503 }),
    );
    await render('session:1');
    await settle(() => expect(container.textContent).toContain('Provider unavailable'));
    await act(async () => container.querySelector('button')?.click());
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    expect(fetch_mock).toHaveBeenCalledTimes(2);
  });

  it('offers retry when a connected socket never sends a frame', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await render('session:1');
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const deadline = timers.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
    if (typeof deadline !== 'function') throw new Error('The first-frame deadline is missing.');
    await act(async () => deadline());
    expect(container.textContent).toContain('The browser did not send a frame');
    expect(container.textContent).toContain('Retry browser');
    expect(TestSocket.instances[0]?.close).toHaveBeenCalled();
  });

  it('aborts obsolete startup requests and never shows another chat response', async () => {
    let resolve_first: ((response: Response) => void) | undefined;
    fetch_mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_first = resolve;
        }),
    );
    await render('session:1');
    const first_signal = fetch_mock.mock.calls[0]?.[1]?.signal;
    await render('session:2');
    expect(first_signal?.aborted).toBe(true);
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    await act(async () =>
      resolve_first?.(
        Response.json({ data: { ...preview, preview_url: 'https://obsolete.test' } }),
      ),
    );
    expect(TestSocket.instances.every((socket) => !socket.url.includes('obsolete.test'))).toBe(
      true,
    );
    await act(async () => root.render(null));
    expect(TestSocket.instances[0]?.close).toHaveBeenCalled();
  });

  it('forwards keyboard modifiers without typing shortcut letters', async () => {
    await render('session:1');
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const socket = TestSocket.instances[0];
    if (!socket) throw new Error('The browser socket did not open.');
    await act(async () => socket.onopen?.());
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Take control'))
        ?.click(),
    );
    const surface = container.querySelector('[role="application"]');
    if (!surface) throw new Error('The browser canvas did not mount.');
    await act(async () => {
      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          ctrlKey: true,
          bubbles: true,
        }),
      );
      surface.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          ctrlKey: true,
          bubbles: true,
        }),
      );
      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'A',
          code: 'KeyA',
          keyCode: 65,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      {
        type: 'input_keyboard',
        eventType: 'keyDown',
        key: 'a',
        code: 'KeyA',
        text: '',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      },
      {
        type: 'input_keyboard',
        eventType: 'keyUp',
        key: 'a',
        code: 'KeyA',
        text: '',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      },
      {
        type: 'input_keyboard',
        eventType: 'keyDown',
        key: 'A',
        code: 'KeyA',
        text: 'A',
        windowsVirtualKeyCode: 65,
        modifiers: 8,
      },
    ]);
  });

  it('selects the full address before typing replaces it', async () => {
    await render('session:1');
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const socket = TestSocket.instances[0];
    if (!socket) throw new Error('The browser socket did not open.');
    const current_url = 'https://alfera.ai/a/long/path';
    await act(async () => {
      socket.onopen?.();
      socket.onmessage?.({ data: JSON.stringify({ type: 'url', url: current_url }) });
    });
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Take control'))
        ?.click(),
    );
    const address = container.querySelector<HTMLInputElement>('[aria-label="Address"]');
    if (!address) throw new Error('The address field did not mount.');
    await act(async () => address.focus());
    expect(address.value).toBe(current_url);
    expect([address.selectionStart, address.selectionEnd]).toEqual([0, current_url.length]);
    await act(async () => {
      const replacement = `${address.value.slice(0, address.selectionStart ?? 0)}https://example.com${address.value.slice(address.selectionEnd ?? 0)}`;
      const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!set_value) throw new Error('The native input setter is missing.');
      set_value.call(address, replacement);
      address.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => address.form?.requestSubmit());
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(data))).toContainEqual(
      expect.objectContaining({ type: 'control', action: 'navigate', url: 'https://example.com' }),
    );
  });

  it('refreshes the visible browser without replacing its canvas and stops on unmount', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const clear_interval = vi.spyOn(globalThis, 'clearInterval');
    await render('session:1');
    await settle(() => expect(TestSocket.instances).toHaveLength(1));
    const canvas = container.querySelector('canvas');
    const heartbeat = intervals.mock.calls.find(([, delay]) => delay === 60_000)?.[0];
    if (typeof heartbeat !== 'function') throw new Error('The browser heartbeat is missing.');
    let complete_heartbeat: ((response: Response) => void) | undefined;
    fetch_mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete_heartbeat = resolve;
        }),
    );
    await act(async () => heartbeat());
    expect(fetch_mock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(TestSocket.instances).toHaveLength(1);
    await act(async () =>
      complete_heartbeat?.(
        Response.json({ data: { ...preview, last_updated_time: '2026-09-09T00:01:00.000Z' } }),
      ),
    );
    await settle(() => expect(container.querySelector('canvas')).toBe(canvas));
    expect(TestSocket.instances).toHaveLength(1);
    const latest_interval = intervals.mock.calls.reduce(
      (latest, [, delay], index) => (delay === 60_000 ? index : latest),
      -1,
    );
    const timer = intervals.mock.results[latest_interval]?.value;
    await act(async () => root.render(null));
    expect(clear_interval).toHaveBeenCalledWith(timer);
    expect(TestSocket.instances[0]?.close).toHaveBeenCalled();
  });
});
