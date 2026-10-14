import { z } from 'zod';

const connection_setup_return_event_type = 'coworker.connection_setup_return';
const connection_setup_return_channel = 'coworker:connection-setup-return';
const connection_setup_return_storage_key = 'coworker:connection-setup-return';

export type ConnectionSetupReturnEvent = {
  type: typeof connection_setup_return_event_type;
  status: 'success' | 'error';
  connection_id?: string;
  provider_key?: string;
  setup_token?: string;
  error_message?: string;
  returned_time: string;
};

const connection_setup_return_event_schema = z.object({
  type: z.literal(connection_setup_return_event_type),
  status: z.enum(['success', 'error']),
  connection_id: z.string().trim().min(1).optional(),
  provider_key: z.string().trim().min(1).optional(),
  setup_token: z.string().trim().min(1).optional(),
  error_message: z.string().trim().min(1).optional(),
  returned_time: z
    .string()
    .trim()
    .min(1)
    .default(() => new Date().toISOString()),
});

export function build_connection_setup_return_url(origin: string) {
  return new URL('/connect/callback', origin).toString();
}

// Where /connect/callback should send the tab back to after a SAME-TAB connect (onboarding).
// sessionStorage is tab-scoped, so it survives the cross-origin OAuth round-trip in this tab but
// is invisible to the integrations popup (a separate tab) — that flow closes instead of redirects.
const connection_setup_return_to_key = 'coworker:connection-setup-return-to';

export function set_connection_setup_return_to(path: string) {
  const browser_window = read_browser_window();
  try_call(() => browser_window?.sessionStorage.setItem(connection_setup_return_to_key, path));
}

export function take_connection_setup_return_to(): string | null {
  const browser_window = read_browser_window();
  if (!browser_window) return null;
  try {
    const path = browser_window.sessionStorage.getItem(connection_setup_return_to_key);
    browser_window.sessionStorage.removeItem(connection_setup_return_to_key);
    return path;
  } catch {
    return null;
  }
}

export function read_connection_setup_return_event(url: string | URL): ConnectionSetupReturnEvent {
  const parsed_url = typeof url === 'string' ? new URL(url) : url;
  const connection_id = read_param(parsed_url.searchParams, 'connection_id');
  const provider_key = read_param(parsed_url.searchParams, 'provider_key');
  const setup_token = read_param(parsed_url.searchParams, 'setup_token');
  const error_message =
    read_param(parsed_url.searchParams, 'error_description') ??
    read_param(parsed_url.searchParams, 'error') ??
    read_param(parsed_url.searchParams, 'connection_setup_error');

  return {
    type: connection_setup_return_event_type,
    status: error_message ? 'error' : 'success',
    ...(connection_id ? { connection_id } : {}),
    ...(provider_key ? { provider_key } : {}),
    ...(setup_token ? { setup_token } : {}),
    ...(error_message ? { error_message } : {}),
    returned_time: new Date().toISOString(),
  };
}

const hosted_setup_provider_keys = ['composio'] as const;

export type HostedSetupProviderKey = (typeof hosted_setup_provider_keys)[number];

export function should_complete_connection_setup_return(
  event: ConnectionSetupReturnEvent,
): event is ConnectionSetupReturnEvent & {
  status: 'success';
  connection_id: string;
  provider_key: HostedSetupProviderKey;
  setup_token?: string;
} {
  return (
    event.status === 'success' &&
    Boolean(event.connection_id) &&
    is_hosted_setup_provider_key(event.provider_key)
  );
}

function is_hosted_setup_provider_key(
  provider_key: string | undefined,
): provider_key is HostedSetupProviderKey {
  return hosted_setup_provider_keys.some((key) => key === provider_key);
}

export function publish_connection_setup_return(event: ConnectionSetupReturnEvent) {
  const browser_window = read_browser_window();
  if (!browser_window) return;

  try_call(() => {
    const channel = create_broadcast_channel();
    channel?.postMessage(event);
    channel?.close();
  });

  try_call(() => {
    browser_window.localStorage.setItem(connection_setup_return_storage_key, JSON.stringify(event));
  });
  try_call(() => browser_window.opener?.postMessage(event, browser_window.location.origin));
  try_call(() => browser_window.opener?.focus());
}

export function subscribe_to_connection_setup_returns(
  onReturn: (event: ConnectionSetupReturnEvent) => void,
) {
  const browser_window = read_browser_window();
  if (!browser_window) return () => {};

  const channel = create_broadcast_channel();
  const delivered_event_keys = new Set<string>();
  const deliver_once = (value: unknown) => {
    const event = parse_connection_setup_return_event(value);
    if (!event) return;
    const event_key = connection_setup_return_event_key(event);
    if (delivered_event_keys.has(event_key)) return;
    delivered_event_keys.add(event_key);
    onReturn(event);
  };
  const on_message = (message: MessageEvent) => {
    deliver_once(message.data);
  };
  const on_storage = (storage_event: StorageEvent) => {
    if (storage_event.key !== connection_setup_return_storage_key) return;
    deliver_once(storage_event.newValue);
  };

  channel?.addEventListener('message', on_message);
  browser_window.addEventListener('message', on_message);
  browser_window.addEventListener('storage', on_storage);

  return () => {
    channel?.removeEventListener('message', on_message);
    channel?.close();
    browser_window.removeEventListener('message', on_message);
    browser_window.removeEventListener('storage', on_storage);
  };
}

function connection_setup_return_event_key(event: ConnectionSetupReturnEvent) {
  return [
    event.returned_time,
    event.status,
    event.connection_id ?? '',
    event.provider_key ?? '',
    event.error_message ?? '',
  ].join(':');
}

function read_param(search_params: URLSearchParams, key: string) {
  const value = search_params.get(key)?.trim();
  return value ? value : null;
}

function parse_connection_setup_return_event(value: unknown): ConnectionSetupReturnEvent | null {
  const parsed_value = typeof value === 'string' ? parse_json(value) : value;
  const result = connection_setup_return_event_schema.safeParse(parsed_value);
  if (!result.success) return null;
  const event = result.data;
  return {
    type: event.type,
    status: event.status,
    returned_time: event.returned_time,
    ...(event.connection_id ? { connection_id: event.connection_id } : {}),
    ...(event.provider_key ? { provider_key: event.provider_key } : {}),
    ...(event.setup_token ? { setup_token: event.setup_token } : {}),
    ...(event.error_message ? { error_message: event.error_message } : {}),
  };
}

function create_broadcast_channel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(connection_setup_return_channel);
}

function parse_json(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function try_call(action: () => void) {
  try {
    action();
  } catch {
    return;
  }
}

function read_browser_window() {
  return typeof window === 'undefined' ? null : window;
}
