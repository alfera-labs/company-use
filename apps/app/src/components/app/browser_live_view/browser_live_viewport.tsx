import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { ArrowLeft, ArrowRight, Globe, Keyboard, Lock, Plus, RotateCw, X } from 'lucide-react';
import { AnimatePresence, motion, Reorder, useReducedMotion } from 'motion/react';
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  type BrowserTask,
  BrowserTaskControls,
} from '@/components/app/browser_live_view/browser_task_controls';
import {
  device_to_display,
  type LiveViewTab,
  reconcile_tab_order,
} from '@/components/app/browser_live_view/live_stream_protocol';
import { useBrowserInput } from '@/components/app/browser_live_view/use_browser_input';
import {
  type BrowserLiveStream,
  useBrowserLiveStream,
} from '@/components/app/browser_live_view/use_browser_live_stream';
import type { SandboxUrlPreview } from '@/lib/api';

export function BrowserLiveViewport({
  preview,
  on_retry,
  browser_task,
}: {
  preview: SandboxUrlPreview;
  browser_task?: BrowserTask | undefined;
  on_retry?: () => void;
}) {
  const control_owner_id = `${preview.sandbox_url_preview_id}:${browser_task?.run_id ?? 'manual'}`;
  const [control_owner, set_control_owner] = useState<string | null>(null);
  const has_control = control_owner === control_owner_id;
  const stream = useBrowserLiveStream(preview, has_control);
  const viewport_ref = useRef<HTMLDivElement>(null);
  const surface_ref = useRef<HTMLDivElement>(null);
  const { release_input, ...input_props } = useBrowserInput(surface_ref, stream, has_control);
  const release_control = () => {
    release_input();
    flushSync(() => set_control_owner(null));
    viewport_ref.current?.querySelector<HTMLButtonElement>('[data-browser-control]')?.focus();
  };

  return (
    <BrowserLiveViewportView
      stream={stream}
      has_control={has_control}
      on_control_granted={() => flushSync(() => set_control_owner(control_owner_id))}
      on_control_released={release_control}
      viewport_ref={viewport_ref}
      surface_ref={surface_ref}
      input_props={input_props}
      browser_task={browser_task}
      on_retry={on_retry}
      control_owner_id={control_owner_id}
    />
  );
}

export function BrowserLiveViewportView({
  stream,
  has_control,
  on_control_granted,
  on_control_released,
  viewport_ref,
  surface_ref,
  input_props,
  browser_task,
  on_retry,
  control_owner_id,
  can_interact = true,
}: {
  stream: BrowserLiveStream;
  has_control: boolean;
  on_control_granted: () => void;
  on_control_released: () => void;
  viewport_ref: React.RefObject<HTMLDivElement | null>;
  surface_ref: React.RefObject<HTMLDivElement | null>;
  input_props: Omit<ReturnType<typeof useBrowserInput>, 'release_input'>;
  browser_task?: BrowserTask | undefined;
  on_retry?: (() => void) | undefined;
  control_owner_id: string;
  can_interact?: boolean;
}) {
  return (
    <div
      ref={viewport_ref}
      className="flex min-h-0 flex-1 flex-col bg-muted/30"
      onKeyDownCapture={(event) => {
        if (!has_control || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        on_control_released();
      }}
    >
      <BrowserTabBar canControl={has_control} stream={stream} />
      <BrowserAddressBar canControl={has_control} stream={stream} />
      <LiveCanvas
        canControl={has_control}
        input={input_props}
        surface_ref={surface_ref}
        stream={stream}
        on_retry={on_retry}
      />
      <BrowserTaskControls
        key={control_owner_id}
        can_interact={can_interact}
        task={browser_task}
        has_control={has_control}
        on_control_granted={on_control_granted}
        on_control_released={on_control_released}
        focus_browser={() =>
          viewport_ref.current?.querySelector<HTMLElement>('[role="application"]')?.focus()
        }
      />
    </div>
  );
}

function BrowserTabBar({ canControl, stream }: { canControl: boolean; stream: BrowserLiveStream }) {
  const tab_strip_ref = useRef<HTMLUListElement>(null);
  const closing_tab_ref = useRef<{ tab_id: string; button: HTMLButtonElement } | null>(null);
  const live = stream.status === 'live';
  const [order, set_order] = useState<string[]>([]);
  useEffect(() => {
    set_order((current) => reconcile_tab_order(current, stream.tabs));
    const closing = closing_tab_ref.current;
    if (!closing || stream.tabs.some((tab) => tab.tabId === closing.tab_id)) return;
    closing_tab_ref.current = null;
    if (document.activeElement !== document.body && document.activeElement !== closing.button)
      return;
    const active = stream.tabs.find((tab) => tab.active) ?? stream.tabs[0];
    Array.from(tab_strip_ref.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
      .find((tab) => tab.dataset.tabId === active?.tabId)
      ?.focus();
  }, [stream.tabs]);
  const by_id = new Map(stream.tabs.map((tab) => [tab.tabId, tab]));
  const ordered = order.map((id) => by_id.get(id)).filter((tab): tab is LiveViewTab => !!tab);

  return (
    <div className="flex items-end gap-1 px-2 pt-1.5">
      <Reorder.Group
        ref={tab_strip_ref}
        role="tablist"
        aria-label="Browser tabs"
        axis="x"
        values={order}
        onReorder={set_order}
        onKeyDown={(event) => {
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
          );
          const index = tabs.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (index - 1 + tabs.length) % tabs.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : -1;
          if (next < 0 || index < 0) return;
          event.preventDefault();
          tabs[next]?.focus();
          tabs[next]?.click();
        }}
        className="flex min-w-0 items-end gap-1 overflow-x-auto"
      >
        {ordered.map((tab) => (
          <BrowserTab
            key={tab.tabId}
            tab={tab}
            can_close={canControl && ordered.length > 1 && live}
            canControl={canControl}
            onSelect={() => canControl && !tab.active && stream.switch_tab(tab.tabId)}
            onClose={(button) => {
              if (document.activeElement === button)
                closing_tab_ref.current = { tab_id: tab.tabId, button };
              stream.close_tab(tab.tabId);
            }}
          />
        ))}
      </Reorder.Group>
      <button
        type="button"
        aria-label="New tab"
        disabled={!live || !canControl}
        onClick={stream.new_tab}
        className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function BrowserTab({
  tab,
  can_close,
  canControl,
  onSelect,
  onClose,
}: {
  tab: LiveViewTab;
  can_close: boolean;
  canControl: boolean;
  onSelect: () => void;
  onClose: (button: HTMLButtonElement) => void;
}) {
  const reduce_motion = useReducedMotion();
  return (
    <Reorder.Item
      value={tab.tabId}
      dragListener={canControl}
      whileDrag={{
        scale: reduce_motion ? 1 : 1.03,
        zIndex: 10,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
      }}
      transition={{ duration: reduce_motion ? 0 : 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        'group relative flex h-8 min-w-[9rem] max-w-[15rem] shrink-0 cursor-default select-none items-center gap-2 rounded-t-2xl pr-1.5 pl-3 text-xs',
        tab.active
          ? 'bg-background font-medium text-foreground shadow-[0_-1px_2px_rgba(0,0,0,0.04)]'
          : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
      )}
    >
      <span
        role="tab"
        data-tab-id={tab.tabId}
        tabIndex={canControl && tab.active ? 0 : -1}
        aria-disabled={!canControl}
        aria-selected={tab.active}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TabFavicon url={tab.url} />
        <span className="truncate">{tab.title || hostname_of(tab.url) || 'New tab'}</span>
      </span>
      {can_close ? (
        <button
          type="button"
          aria-label={`Close ${tab.title || 'tab'}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose(event.currentTarget);
          }}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground',
            tab.active
              ? 'opacity-70'
              : 'opacity-0 group-hover:opacity-70 group-focus-within:opacity-70',
          )}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </Reorder.Item>
  );
}

function TabFavicon({ url }: { url: string }) {
  const host = hostname_of(url);
  const [failed, set_failed] = useState(false);
  if (!host || failed) return <Globe className="size-3.5 shrink-0 text-muted-foreground" />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
      alt=""
      className="size-3.5 shrink-0 rounded-lg"
      onError={() => set_failed(true)}
    />
  );
}

function BrowserAddressBar({
  canControl,
  stream,
}: {
  canControl: boolean;
  stream: BrowserLiveStream;
}) {
  const reduce_motion = useReducedMotion();
  const live = stream.status === 'live';
  const [show_text, set_show_text] = useState(false);
  const [text, set_text] = useState('');
  const secure = stream.url.startsWith('https://');
  const [draft, set_draft] = useState<string | null>(null);
  const shown = draft ?? pretty_url(stream.url);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = normalize_typed_url(draft ?? '');
    set_draft(null);
    if (target) stream.navigate(target);
  };
  const on_key_down = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      set_draft(null);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-2.5 py-1.5">
      <NavButton label="Back" disabled={!live || !canControl} onClick={stream.go_back}>
        <ArrowLeft className="size-4" />
      </NavButton>
      <NavButton label="Forward" disabled={!live || !canControl} onClick={stream.go_forward}>
        <ArrowRight className="size-4" />
      </NavButton>
      <NavButton label="Reload" disabled={!live || !canControl} onClick={stream.reload}>
        <RotateCw className={cn('size-3.5', stream.is_loading && 'motion-safe:animate-spin')} />
      </NavButton>
      <form onSubmit={submit} className="ml-1 flex min-w-0 flex-1">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-xs text-muted-foreground transition-colors focus-within:bg-muted focus-within:ring-1 focus-within:ring-ring">
          {secure ? (
            <Lock className="size-3 shrink-0 text-emerald-600" />
          ) : (
            <Globe className="size-3 shrink-0" />
          )}
          <input
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            aria-label="Address"
            disabled={!live || !canControl}
            value={shown}
            onChange={(event) => set_draft(event.target.value)}
            onFocus={(event) => {
              flushSync(() => set_draft(stream.url));
              event.currentTarget.select();
            }}
            onBlur={() => set_draft(null)}
            onKeyDown={on_key_down}
            className="min-w-0 flex-1 bg-transparent text-foreground/80 outline-none placeholder:text-muted-foreground"
            placeholder="Enter a URL"
          />
        </label>
      </form>
      <NavButton
        label="Type in browser"
        expanded={show_text}
        disabled={!live || !canControl}
        onClick={() => set_show_text((current) => !current)}
      >
        <Keyboard className="size-4" />
      </NavButton>
      {show_text ? (
        <form
          className="flex w-full items-center gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text) return;
            stream.send_text(text);
            set_text('');
          }}
        >
          <input
            aria-label="Text for browser"
            disabled={!canControl}
            type="text"
            value={text}
            onChange={(event) => set_text(event.target.value)}
            placeholder="Type into the selected page field"
            className="h-8 min-w-0 flex-1 rounded-2xl border border-border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" variant="outline" disabled={!text || !live || !canControl}>
            Insert text
          </Button>
        </form>
      ) : null}
      <AnimatePresence>
        {stream.last_error ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce_motion ? 0 : 0.15 }}
            className="ml-1 max-w-[14rem] truncate text-xs text-destructive"
            title={stream.last_error}
            role="alert"
          >
            {stream.last_error}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  expanded,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function LiveCanvas({
  canControl,
  input,
  surface_ref,
  stream,
  on_retry,
}: {
  canControl: boolean;
  input: Omit<ReturnType<typeof useBrowserInput>, 'release_input'>;
  surface_ref: React.RefObject<HTMLDivElement | null>;
  stream: BrowserLiveStream;
  on_retry: (() => void) | undefined;
}) {
  const reduce_motion = useReducedMotion();
  const [display, set_display] = useState({ width: 0, height: 0 });
  const [is_driving, set_is_driving] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the surface ref stays stable after mount.
  useEffect(() => {
    const surface = surface_ref.current;
    if (!surface) return;
    const observer = new ResizeObserver(() => {
      const rect = surface.getBoundingClientRect();
      set_display({ width: rect.width, height: rect.height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const cursor_display = stream.cursor
    ? device_to_display(stream.cursor, stream.device_size, display)
    : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-muted/30 p-3">
      <div
        ref={surface_ref}
        className="relative max-h-full max-w-full overflow-hidden rounded-2xl border border-border bg-white shadow-sm outline-none touch-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          aspectRatio: `${stream.device_size.width} / ${stream.device_size.height}`,
          width: '100%',
        }}
        // A remote browser the user drives: it must take keyboard focus to forward typing, which
        // is what role="application" is for.
        tabIndex={canControl ? 0 : -1}
        role="application"
        aria-disabled={!canControl}
        inert={!canControl}
        aria-label={
          canControl
            ? 'Live browser. Click, scroll, and type. Press Escape to give back control.'
            : 'Live browser preview. Take control to interact.'
        }
        {...input}
        onPointerEnter={() => set_is_driving(canControl)}
        onPointerLeave={() => set_is_driving(false)}
      >
        <canvas
          ref={stream.bind_canvas}
          className="block size-full transition-opacity duration-300 ease-out motion-reduce:transition-none"
          style={{ opacity: stream.first_frame_ready ? 1 : 0 }}
        />

        {cursor_display ? (
          <motion.div
            className="pointer-events-none absolute left-0 top-0 z-10"
            animate={{
              x: cursor_display.x,
              y: cursor_display.y,
              scale: stream.cursor?.pressed ? 0.82 : 1,
            }}
            transition={
              reduce_motion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 700, damping: 42, mass: 0.5 }
            }
          >
            <AgentCursor caption={stream.caption} />
          </motion.div>
        ) : null}

        <DrivingHint
          visible={canControl && is_driving && stream.status === 'live' && stream.first_frame_ready}
        />
      </div>
      <StreamState stream={stream} on_retry={on_retry} />
    </div>
  );
}

function AgentCursor({ caption }: { caption: string }) {
  const reduce_motion = useReducedMotion();
  return (
    <div className="relative">
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        role="img"
        aria-label="Browser cursor"
        className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      >
        <path
          d="M4 3l13 6.5-5.4 1.6-2 5.4L4 3z"
          fill="#111827"
          stroke="white"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <AnimatePresence>
        {caption ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: reduce_motion ? 0 : 0.12 }}
            className="absolute left-5 top-4 whitespace-nowrap rounded-full bg-neutral-900/90 px-2.5 py-1 text-xs font-medium text-white shadow-md"
          >
            {caption}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StreamState({
  stream,
  on_retry,
}: {
  stream: BrowserLiveStream;
  on_retry: (() => void) | undefined;
}) {
  if (stream.status === 'live' && stream.first_frame_ready) return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center text-sm text-muted-foreground">
      {stream.status === 'closed' ? (
        <>
          <p role="alert">
            {stream.connection_error || 'The browser disconnected. Retry to connect again.'}
          </p>
          {on_retry ? (
            <Button variant="outline" onClick={on_retry}>
              Retry browser
            </Button>
          ) : null}
        </>
      ) : (
        <div role="status" className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 motion-safe:animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground"
          />
          Connecting to the live browser…
        </div>
      )}
    </div>
  );
}

function DrivingHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900/80 px-3 py-1 text-xs text-white">
      Click, scroll, and type · Escape to give back control
    </div>
  );
}

function hostname_of(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

function pretty_url(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host.replace(/^www\./u, '')}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function normalize_typed_url(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
