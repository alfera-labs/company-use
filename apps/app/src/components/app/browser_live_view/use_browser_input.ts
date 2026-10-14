import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import type { BrowserLiveStream } from '@/components/app/browser_live_view/use_browser_live_stream';

const mouse_buttons = ['left', 'middle', 'right'] as const;

export function useBrowserInput(
  surface_ref: RefObject<HTMLDivElement | null>,
  stream: BrowserLiveStream,
  enabled = true,
) {
  const gesture = useRef<{
    pointer_id: number;
    x: number;
    y: number;
    start_x: number;
    start_y: number;
    touch: boolean;
    moved: boolean;
    button: 'left' | 'middle' | 'right';
    clicks: number;
  } | null>(null);
  const last_click = useRef({ time: 0, x: 0, y: 0, count: 0, button: 'left' });
  const forwarded_keys = useRef(
    new Map<
      string,
      { key: string; code: string; modifiers: number; windowsVirtualKeyCode: number }
    >(),
  );
  const send_pointer = stream.send_pointer;
  const send_key = stream.send_key;
  const point = (x: number, y: number) => {
    const rect = surface_ref.current?.getBoundingClientRect();
    return {
      x: x - (rect?.left ?? 0),
      y: y - (rect?.top ?? 0),
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    };
  };

  useEffect(() => {
    if (!enabled) return;
    const surface = surface_ref.current;
    if (!surface) return;
    const scroll = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      send_pointer({
        kind: 'mouseWheel',
        modifiers: modifiers(event),
        display: {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        },
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
      });
    };
    surface.addEventListener('wheel', scroll, { passive: false });
    return () => surface.removeEventListener('wheel', scroll);
  }, [enabled, surface_ref, send_pointer]);

  const release_keys = () => {
    for (const key of forwarded_keys.current.values()) send_key({ kind: 'keyUp', ...key });
    forwarded_keys.current.clear();
  };

  const release_input = () => {
    const current = gesture.current;
    if (current) {
      if (!current.touch)
        send_pointer({
          kind: 'mouseReleased',
          modifiers: 0,
          display: point(current.x, current.y),
          button: current.button,
        });
      const surface = surface_ref.current;
      gesture.current = null;
      if (surface?.hasPointerCapture(current.pointer_id))
        surface.releasePointerCapture(current.pointer_id);
    }
    gesture.current = null;
    release_keys();
    last_click.current = { time: 0, x: 0, y: 0, count: 0, button: 'left' };
  };

  useEffect(() => {
    if (enabled) return;
    gesture.current = null;
    forwarded_keys.current.clear();
    last_click.current = { time: 0, x: 0, y: 0, count: 0, button: 'left' };
  }, [enabled]);

  const cancel_pointer = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointer_id !== event.pointerId) return;
    if (!current.touch)
      send_pointer({
        kind: 'mouseReleased',
        modifiers: modifiers(event),
        display: point(event.clientX, event.clientY),
        button: current.button,
      });
    gesture.current = null;
  };

  return {
    release_input,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!enabled) return;
      if (!event.isPrimary || gesture.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const button = mouse_buttons[event.button] ?? 'left';
      const previous = last_click.current;
      const repeated =
        performance.now() - previous.time < 500 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5 &&
        previous.button === button;
      const clicks = repeated ? Math.min(previous.count + 1, 3) : 1;
      if (event.pointerType !== 'touch')
        last_click.current = {
          time: performance.now(),
          x: event.clientX,
          y: event.clientY,
          count: clicks,
          button,
        };
      gesture.current = {
        pointer_id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start_x: event.clientX,
        start_y: event.clientY,
        touch: event.pointerType === 'touch',
        moved: false,
        button,
        clicks,
      };
      if (event.pointerType !== 'touch')
        send_pointer({
          kind: 'mousePressed',
          modifiers: modifiers(event),
          display: point(event.clientX, event.clientY),
          button,
          clickCount: clicks,
        });
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!enabled) return;
      const current = gesture.current;
      if (current?.touch) {
        if (current.pointer_id !== event.pointerId) return;
        if (Math.hypot(event.clientX - current.start_x, event.clientY - current.start_y) > 5)
          current.moved = true;
        const display = point(event.clientX, event.clientY);
        if (current.moved)
          send_pointer({
            kind: 'mouseWheel',
            modifiers: modifiers(event),
            display,
            deltaX:
              ((current.x - event.clientX) * stream.device_size.width) / Math.max(display.width, 1),
            deltaY:
              ((current.y - event.clientY) * stream.device_size.height) /
              Math.max(display.height, 1),
          });
        current.x = event.clientX;
        current.y = event.clientY;
        return;
      }
      send_pointer({
        kind: 'mouseMoved',
        modifiers: modifiers(event),
        display: point(event.clientX, event.clientY),
        ...(current ? { button: current.button } : {}),
      });
      if (current) {
        current.x = event.clientX;
        current.y = event.clientY;
      }
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (!enabled) return;
      const current = gesture.current;
      if (!current || current.pointer_id !== event.pointerId) return;
      const display = point(event.clientX, event.clientY);
      if (current.touch && !current.moved) {
        last_click.current = {
          time: performance.now(),
          x: event.clientX,
          y: event.clientY,
          count: current.clicks,
          button: current.button,
        };
        send_pointer({
          kind: 'mousePressed',
          modifiers: modifiers(event),
          display,
          button: current.button,
          clickCount: current.clicks,
        });
      }
      if (!current.touch || !current.moved)
        send_pointer({
          kind: 'mouseReleased',
          modifiers: modifiers(event),
          display,
          button: current.button,
          clickCount: current.clicks,
        });
      gesture.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: cancel_pointer,
    onLostPointerCapture: cancel_pointer,
    onContextMenu(event: React.MouseEvent) {
      event.preventDefault();
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!enabled) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') return;
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      const key = {
        key: event.key,
        code: event.code,
        modifiers: modifiers(event),
        windowsVirtualKeyCode: event.keyCode,
      };
      const text =
        !event.ctrlKey && !event.metaKey && !event.altKey
          ? event.key.length === 1
            ? event.key
            : event.key === 'Enter'
              ? '\r'
              : event.key === 'Tab'
                ? '\t'
                : ''
          : '';
      forwarded_keys.current.set(event.code || event.key, key);
      send_key({ kind: 'keyDown', ...key, text });
    },
    onKeyUp(event: KeyboardEvent<HTMLDivElement>) {
      if (!enabled) return;
      if (!forwarded_keys.current.delete(event.code || event.key)) return;
      send_key({
        kind: 'keyUp',
        key: event.key,
        code: event.code,
        modifiers: modifiers(event),
        windowsVirtualKeyCode: event.keyCode,
      });
    },
    onPaste(event: ClipboardEvent<HTMLDivElement>) {
      if (!enabled) return;
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      if (text) stream.send_text(text);
    },
    onBlur: release_keys,
  };
}

function modifiers(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> & { key?: string },
): number {
  const editing_shortcut =
    event.metaKey && ['a', 'c', 'x', 'z', 'y'].includes(event.key?.toLowerCase() ?? '');
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey || editing_shortcut ? 2 : 0) |
    (event.metaKey && !editing_shortcut ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}
