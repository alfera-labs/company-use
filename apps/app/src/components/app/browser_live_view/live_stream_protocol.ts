import { z } from 'zod';
import type { SandboxUrlPreview } from '@/lib/api';

const command_params_schema = z.record(z.string(), z.unknown());
const frame_metadata_schema = z
  .object({
    deviceWidth: z.number().catch(1280),
    deviceHeight: z.number().catch(720),
    timestamp: z.number().optional().catch(undefined),
  })
  .catch({ deviceWidth: 1280, deviceHeight: 720 });
const live_view_tab_schema = z.object({
  tabId: z.string(),
  active: z.boolean().catch(false),
  title: z.string().catch(''),
  url: z.string().catch(''),
});

export type FrameMetadata = {
  deviceWidth: number;
  deviceHeight: number;
  timestamp?: number;
};

export type StreamMessage =
  | { type: 'frame'; seq?: number; data: string; metadata: FrameMetadata }
  | { type: 'tabs'; tabs: LiveViewTab[] }
  | { type: 'url'; url: string }
  | { type: 'status'; connected: boolean; screencasting: boolean }
  | { type: 'command'; action: string; params?: Record<string, unknown> }
  | { type: 'pointer'; kind: 'move' | 'down' | 'up'; x: number; y: number; name?: string }
  | { type: 'control_result'; id: string | null; action: string; ok: boolean; error?: string };

export type LiveViewTab = {
  tabId: string;
  active: boolean;
  title: string;
  url: string;
};

export function build_live_view_ws_url(
  preview: Pick<SandboxUrlPreview, 'preview_url' | 'live_view_token'>,
  options: { max_fps?: number } = {},
): string | undefined {
  if (!preview.live_view_token) return undefined;
  let url: URL;
  try {
    url = new URL(preview.preview_url);
  } catch {
    return undefined;
  }
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('token', preview.live_view_token);
  url.searchParams.set('pacing', 'push');
  url.searchParams.set('maxFps', String(options.max_fps ?? 30));
  return url.toString();
}

export function parse_stream_message(raw: string): StreamMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'frame':
      return typeof message.data === 'string'
        ? {
            type: 'frame',
            data: message.data,
            metadata: read_frame_metadata(message.metadata),
            ...(typeof message.seq === 'number' ? { seq: message.seq } : {}),
          }
        : undefined;
    case 'tabs':
      return { type: 'tabs', tabs: read_tabs(message.tabs) };
    case 'url':
      return typeof message.url === 'string' ? { type: 'url', url: message.url } : undefined;
    case 'status':
      return {
        type: 'status',
        connected: message.connected === true,
        screencasting: message.screencasting === true,
      };
    case 'command': {
      const params = command_params_schema.safeParse(message.params);
      return typeof message.action === 'string'
        ? {
            type: 'command',
            action: message.action,
            ...(params.success ? { params: params.data } : {}),
          }
        : undefined;
    }
    case 'pointer':
      return read_pointer(message);
    case 'control_result':
      return typeof message.action === 'string'
        ? {
            type: 'control_result',
            id: typeof message.id === 'string' ? message.id : null,
            action: message.action,
            ok: message.ok === true,
            ...(typeof message.error === 'string' ? { error: message.error } : {}),
          }
        : undefined;
    default:
      return undefined;
  }
}

export function reconcile_tab_order(previous_order: string[], tabs: LiveViewTab[]): string[] {
  const live = new Set(tabs.map((tab) => tab.tabId));
  const kept = previous_order.filter((id) => live.has(id));
  const known = new Set(kept);
  const added = tabs.map((tab) => tab.tabId).filter((id) => !known.has(id));
  return [...kept, ...added];
}

const command_verbs: Record<string, string> = {
  click: 'Clicking',
  fill: 'Typing',
  type: 'Typing',
  select: 'Choosing',
  navigate: 'Opening',
  open: 'Opening',
  tab_new: 'Opening a new tab',
  tab: 'Switching tab',
  tab_switch: 'Switching tab',
  wait: 'Waiting for the page',
  scroll: 'Scrolling',
  snapshot: 'Reading the page',
};

const silent_actions = new Set(['launch', 'url', 'get', 'connect', 'tab_list']);

export function caption_for_activity(input: {
  action?: string;
  target_name?: string;
  url?: string;
}): string {
  const action = input.action ?? '';
  if (silent_actions.has(action)) return '';
  if (action === 'navigate' || action === 'open') {
    const host = hostname_of(input.url);
    return host ? `Opening ${host}` : 'Opening page';
  }
  const verb = command_verbs[action];
  if ((action === 'click' || action === 'fill' || action === 'select') && input.target_name) {
    return `${verb ?? capitalize(action)} ${input.target_name}`;
  }
  if (verb) return verb;
  return action ? capitalize(action.replace(/_/gu, ' ')) : '';
}

export function display_to_device(
  point: { x: number; y: number },
  display: { width: number; height: number },
  device: { width: number; height: number },
): { x: number; y: number } {
  if (display.width <= 0 || display.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.round((point.x / display.width) * device.width),
    y: Math.round((point.y / display.height) * device.height),
  };
}

export function device_to_display(
  point: { x: number; y: number },
  device: { width: number; height: number },
  display: { width: number; height: number },
): { x: number; y: number } {
  if (device.width <= 0 || device.height <= 0) return { x: 0, y: 0 };
  return {
    x: (point.x / device.width) * display.width,
    y: (point.y / device.height) * display.height,
  };
}

function read_frame_metadata(value: unknown): FrameMetadata {
  const record = frame_metadata_schema.parse(value);
  return {
    deviceWidth: record.deviceWidth,
    deviceHeight: record.deviceHeight,
    ...(record.timestamp !== undefined ? { timestamp: record.timestamp } : {}),
  };
}

function read_tabs(value: unknown): LiveViewTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const tab = live_view_tab_schema.safeParse(entry);
    return tab.success ? [tab.data] : [];
  });
}

function read_pointer(message: Record<string, unknown>): StreamMessage | undefined {
  const kind = message.kind;
  if (kind !== 'move' && kind !== 'down' && kind !== 'up') return undefined;
  if (typeof message.x !== 'number' || typeof message.y !== 'number') return undefined;
  return {
    type: 'pointer',
    kind,
    x: message.x,
    y: message.y,
    ...(typeof message.name === 'string' && message.name ? { name: message.name } : {}),
  };
}

function hostname_of(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return undefined;
  }
}

function capitalize(text: string): string {
  return text ? text[0]?.toUpperCase() + text.slice(1) : text;
}
