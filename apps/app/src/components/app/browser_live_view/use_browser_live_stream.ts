import { useCallback, useEffect, useRef, useState } from 'react';
import {
  build_live_view_ws_url,
  caption_for_activity,
  display_to_device,
  type FrameMetadata,
  type LiveViewTab,
  parse_stream_message,
} from '@/components/app/browser_live_view/live_stream_protocol';
import type { SandboxUrlPreview } from '@/lib/api';

type LiveStreamStatus = 'connecting' | 'live' | 'closed';

type LiveCursor = {
  x: number;
  y: number;
  pressed: boolean;
};

export type BrowserLiveStream = {
  status: LiveStreamStatus;
  connection_error: string;
  first_frame_ready: boolean;
  is_loading: boolean;
  last_error: string;
  tabs: LiveViewTab[];
  url: string;
  caption: string;
  cursor: LiveCursor | undefined;
  device_size: { width: number; height: number };
  bind_canvas: (canvas: HTMLCanvasElement | null) => void;
  send_pointer: (event: {
    kind: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
    display: { x: number; y: number; width: number; height: number };
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    modifiers?: number;
    deltaX?: number;
    deltaY?: number;
  }) => void;
  send_key: (event: {
    kind: 'keyDown' | 'keyUp' | 'char';
    key?: string;
    code?: string;
    text?: string;
    windowsVirtualKeyCode?: number;
    // Bitmask: 1=Alt, 2=Ctrl, 4=Meta, 8=Shift (agent-browser's convention).
    modifiers?: number;
  }) => void;
  send_text: (text: string) => void;
  go_back: () => void;
  go_forward: () => void;
  reload: () => void;
  navigate: (url: string) => void;
  new_tab: () => void;
  switch_tab: (tab_id: string) => void;
  close_tab: (tab_id: string) => void;
};

const cursor_idle_ms = 2_500;
const caption_idle_ms = 4_000;
const loading_timeout_ms = 8_000;
const error_idle_ms = 5_000;

export function useBrowserLiveStream(
  preview: SandboxUrlPreview,
  allow_input = false,
): BrowserLiveStream {
  const url = build_live_view_ws_url(preview);
  const [status, set_status] = useState<LiveStreamStatus>('connecting');
  const [connection_error, set_connection_error] = useState('');
  const [tabs, set_tabs] = useState<LiveViewTab[]>([]);
  const tab_count_ref = useRef(0);
  const [page_url, set_page_url] = useState('');
  const [caption, set_caption] = useState('');
  const [cursor, set_cursor] = useState<LiveCursor | undefined>(undefined);
  const [device_size, set_device_size] = useState({ width: 1280, height: 720 });
  const [is_loading, set_is_loading] = useState(false);
  const [last_error, set_last_error] = useState('');

  const socket_ref = useRef<WebSocket | undefined>(undefined);
  const canvas_ref = useRef<HTMLCanvasElement | null>(null);
  const device_ref = useRef(device_size);
  const last_command_ref = useRef<string | undefined>(undefined);
  const cursor_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const caption_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loading_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const error_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connection_timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const control_counter_ref = useRef(0);
  const latest_frame_ref = useRef<{ data: string; metadata: FrameMetadata } | undefined>(undefined);
  const frame_version_ref = useRef(0);
  const frame_epoch_ref = useRef(0);

  const bind_canvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvas_ref.current = canvas;
  }, []);

  const [first_frame_ready, set_first_frame_ready] = useState(false);

  useEffect(() => {
    let animation_frame = 0;
    let drawn_version = -1;
    let decode_in_flight = false;
    let disposed = false;

    const paint = (source: CanvasImageSource, width: number, height: number, version: number) => {
      const canvas = canvas_ref.current;
      if (!canvas) return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      drawn_version = version;
      device_ref.current = { width, height };
      set_device_size((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
      set_first_frame_ready(true);
      clearTimeout(connection_timer_ref.current);
    };

    const decode = (frame: { data: string; metadata: FrameMetadata }, version: number) => {
      const epoch = frame_epoch_ref.current;
      const data_url = `data:image/jpeg;base64,${frame.data}`;
      if (typeof createImageBitmap === 'function') {
        fetch(data_url)
          .then((response) => response.blob())
          .then((blob) => createImageBitmap(blob))
          .then((bitmap) => {
            if (!disposed && epoch === frame_epoch_ref.current)
              paint(bitmap, bitmap.width, bitmap.height, version);
            bitmap.close();
          })
          .catch((error: unknown) => console.debug('decode live browser frame', error))
          .finally(() => {
            decode_in_flight = false;
          });
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (!disposed && epoch === frame_epoch_ref.current)
          paint(image, image.naturalWidth, image.naturalHeight, version);
        decode_in_flight = false;
      };
      image.onerror = () => {
        decode_in_flight = false;
      };
      image.src = data_url;
    };

    const tick = () => {
      const frame = latest_frame_ref.current;
      const version = frame_version_ref.current;
      if (canvas_ref.current && frame && version !== drawn_version && !decode_in_flight) {
        decode_in_flight = true;
        decode(frame, version);
      }
      animation_frame = requestAnimationFrame(tick);
    };
    animation_frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation_frame);
    };
  }, []);

  const bump_cursor = useCallback((next: LiveCursor) => {
    set_cursor(next);
    if (cursor_timer_ref.current) clearTimeout(cursor_timer_ref.current);
    cursor_timer_ref.current = setTimeout(() => set_cursor(undefined), cursor_idle_ms);
  }, []);

  const bump_caption = useCallback((text: string) => {
    if (!text) return;
    set_caption(text);
    if (caption_timer_ref.current) clearTimeout(caption_timer_ref.current);
    caption_timer_ref.current = setTimeout(() => set_caption(''), caption_idle_ms);
  }, []);

  const start_loading = useCallback(() => {
    set_is_loading(true);
    if (loading_timer_ref.current) clearTimeout(loading_timer_ref.current);
    loading_timer_ref.current = setTimeout(() => set_is_loading(false), loading_timeout_ms);
  }, []);

  const stop_loading = useCallback(() => {
    set_is_loading(false);
    if (loading_timer_ref.current) clearTimeout(loading_timer_ref.current);
  }, []);

  const show_error = useCallback((text: string) => {
    set_last_error(text);
    if (error_timer_ref.current) clearTimeout(error_timer_ref.current);
    error_timer_ref.current = setTimeout(() => set_last_error(''), error_idle_ms);
  }, []);

  useEffect(() => {
    if (!url) {
      set_connection_error('The browser address is missing. Retry to start it again.');
      set_status('closed');
      return;
    }
    set_status('connecting');
    set_connection_error('');
    set_first_frame_ready(false);
    latest_frame_ref.current = undefined;
    frame_epoch_ref.current += 1;
    let upstream_streaming = true;
    const socket = new WebSocket(url);
    socket_ref.current = socket;
    const wait_for_frame = () => {
      clearTimeout(connection_timer_ref.current);
      connection_timer_ref.current = setTimeout(() => {
        set_connection_error('The browser did not send a frame. Retry to connect again.');
        set_status('closed');
        socket.close();
      }, 30_000);
    };
    wait_for_frame();

    socket.onopen = () => set_status('live');
    const disconnect = () => {
      latest_frame_ref.current = undefined;
      frame_epoch_ref.current += 1;
      clearTimeout(connection_timer_ref.current);
      set_connection_error(
        (current) => current || 'The browser disconnected. Retry to connect again.',
      );
      set_status('closed');
    };
    socket.onclose = disconnect;
    socket.onerror = disconnect;
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = parse_stream_message(event.data);
      if (!message) return;
      if (message.type === 'status') {
        upstream_streaming = message.connected && message.screencasting;
        if (!message.connected) disconnect();
        else {
          set_connection_error('');
          set_status(message.screencasting ? 'live' : 'connecting');
          if (!message.screencasting) {
            latest_frame_ref.current = undefined;
            frame_epoch_ref.current += 1;
            set_first_frame_ready(false);
          }
          if (!latest_frame_ref.current) {
            set_first_frame_ready(false);
            wait_for_frame();
          }
        }
        return;
      }
      if (message.type === 'frame') {
        if (!upstream_streaming) return;
        set_connection_error('');
        set_status('live');
        latest_frame_ref.current = { data: message.data, metadata: message.metadata };
        frame_version_ref.current += 1;
        if (typeof message.seq === 'number' && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ack', seq: message.seq }));
        }
        return;
      }
      if (message.type === 'tabs') {
        set_tabs(message.tabs);
        tab_count_ref.current = message.tabs.length;
        const active = message.tabs.find((tab) => tab.active);
        if (active?.url) set_page_url(active.url);
        stop_loading();
        return;
      }
      if (message.type === 'url') {
        // Tab data owns the active address. Unscoped URL events can arrive late, even with one tab.
        if (tab_count_ref.current === 0) set_page_url(message.url);
        stop_loading();
        return;
      }
      if (message.type === 'command') {
        last_command_ref.current = message.action;
        if (message.action === 'navigate' || message.action === 'tab_new') start_loading();
        const url_param = typeof message.params?.url === 'string' ? message.params.url : undefined;
        bump_caption(
          caption_for_activity({
            action: message.action,
            ...(url_param ? { url: url_param } : {}),
          }),
        );
        return;
      }
      if (message.type === 'control_result') {
        if (!message.ok) {
          stop_loading();
          show_error(message.error ?? `${message.action} failed`);
        }
        return;
      }
      if (message.type === 'pointer') {
        bump_cursor({ x: message.x, y: message.y, pressed: message.kind === 'down' });
        if (message.kind === 'down' && message.name) {
          bump_caption(
            caption_for_activity({
              action: last_command_ref.current ?? 'click',
              target_name: message.name,
            }),
          );
        }
      }
    };

    return () => {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
      socket_ref.current = undefined;
      for (const timer of [
        cursor_timer_ref,
        caption_timer_ref,
        loading_timer_ref,
        error_timer_ref,
        connection_timer_ref,
      ]) {
        if (timer.current) clearTimeout(timer.current);
      }
    };
  }, [url, bump_cursor, bump_caption, start_loading, stop_loading, show_error]);

  const last_move_sent_ref = useRef(0);
  const send_pointer = useCallback<BrowserLiveStream['send_pointer']>(
    (event) => {
      if (!allow_input) return;
      const socket = socket_ref.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (event.kind === 'mouseMoved') {
        const now = performance.now();
        if (now - last_move_sent_ref.current < 16) return;
        last_move_sent_ref.current = now;
      }
      const device = device_ref.current;
      const point = display_to_device(
        { x: event.display.x, y: event.display.y },
        { width: event.display.width, height: event.display.height },
        device,
      );
      socket.send(
        JSON.stringify({
          type: 'input_mouse',
          eventType: event.kind,
          x: point.x,
          y: point.y,
          ...(event.button ? { button: event.button } : {}),
          ...(event.clickCount !== undefined ? { clickCount: event.clickCount } : {}),
          modifiers: event.modifiers ?? 0,
          ...(event.deltaX !== undefined ? { deltaX: event.deltaX } : {}),
          ...(event.deltaY !== undefined ? { deltaY: event.deltaY } : {}),
        }),
      );
    },
    [allow_input],
  );

  const send_key = useCallback<BrowserLiveStream['send_key']>(
    (event) => {
      if (!allow_input) return;
      const socket = socket_ref.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: 'input_keyboard',
          eventType: event.kind,
          key: event.key ?? '',
          code: event.code ?? '',
          text: event.text ?? '',
          windowsVirtualKeyCode: event.windowsVirtualKeyCode ?? 0,
          modifiers: event.modifiers ?? 0,
        }),
      );
    },
    [allow_input],
  );

  const send_text = useCallback(
    (text: string) => {
      // CDP char events carry one character. Iteration keeps Unicode surrogate pairs together.
      for (const character of text) send_key({ kind: 'char', text: character });
    },
    [send_key],
  );

  const send_control = useCallback(
    (action: string, payload: Record<string, string> = {}, loads = false) => {
      if (!allow_input) return;
      const socket = socket_ref.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      control_counter_ref.current += 1;
      if (loads) start_loading();
      socket.send(
        JSON.stringify({
          type: 'control',
          id: String(control_counter_ref.current),
          action,
          ...payload,
        }),
      );
    },
    [allow_input, start_loading],
  );
  const go_back = useCallback(() => send_control('back', {}, true), [send_control]);
  const go_forward = useCallback(() => send_control('forward', {}, true), [send_control]);
  const reload = useCallback(() => send_control('reload', {}, true), [send_control]);
  const navigate = useCallback(
    (target: string) => send_control('navigate', { url: target }, true),
    [send_control],
  );
  const new_tab = useCallback(() => send_control('tab_new', {}, true), [send_control]);
  const switch_tab = useCallback(
    (tab_id: string) => send_control('tab_switch', { tab_id }, true),
    [send_control],
  );
  const close_tab = useCallback(
    (tab_id: string) => send_control('tab_close', { tab_id }),
    [send_control],
  );

  return {
    status,
    connection_error,
    first_frame_ready,
    is_loading,
    last_error,
    tabs,
    url: page_url,
    caption,
    cursor,
    device_size,
    bind_canvas,
    send_pointer,
    send_key,
    send_text,
    go_back,
    go_forward,
    reload,
    navigate,
    new_tab,
    switch_tab,
    close_tab,
  };
}
