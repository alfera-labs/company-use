import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import '@/components/app/chat_activity_breathe.css';
import { cn } from '@coworker/ui/lib/utils';
import {
  ActivityChevron,
  ActivityGlyph,
  activity_row_class_name,
} from '@/components/app/chat_activity_row';
import {
  is_chat_tool_part,
  type ProjectedChatMessage,
  type ProjectedChatMessagePart,
  type ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';
import {
  connection_ask_visibility,
  has_connection_row,
} from '@/components/app/connection_ask_visibility';
import {
  type CatalogApp,
  type Connection,
  cancel_connection_setup,
  list_connections,
  postpone_connection_setup,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { app_icon_url, normalize_app_key } from '@/lib/catalog_app';
import {
  read_connection_ask_postponed,
  write_connection_ask_postponed,
} from '@/lib/connection_ask_postponed';

export type ConnectionSetupApp = {
  app_id?: string;
  app_name: string;
  app_display_name: string;
  description?: string;
  icon_url?: string;
};

export type ConnectionSetupToolOutput = {
  app: ConnectionSetupApp;
  start_url: string;
};

type ConnectionSetupPayload = {
  type?: string;
  start_url?: string;
  app?: Partial<ConnectionSetupApp>;
  data?: ConnectionSetupPayload;
  content_json?: ConnectionSetupPayload;
  content?: Array<{ text?: string }>;
};

export type ConnectionRequest = ConnectionSetupToolOutput & {
  app_key: string;
  requested_ms?: number;
  tool_call_id: string;
};

export type ConnectedAppTimes = Record<string, number>;

const connection_receipt_ms = 900;

export function ChatConnectionDock({
  apps,
  connectedApps,
  messages,
}: {
  apps: CatalogApp[];
  connectedApps?: ConnectedAppTimes | undefined;
  messages: ProjectedChatMessage[];
}) {
  const requests = latest_connection_requests(messages);

  if (!connectedApps || requests.length === 0) return null;
  return <ConnectionAsks apps={apps} connectedApps={connectedApps} requests={requests} />;
}

function ConnectionAsks({
  apps,
  connectedApps,
  requests,
}: {
  apps: CatalogApp[];
  connectedApps: ConnectedAppTimes;
  requests: ConnectionRequest[];
}) {
  const connections_query = useQuery({
    queryFn: list_connections,
    queryKey: query_keys.connections(),
  });
  const connections = connections_query.data;
  const asks = requests.map((request) => ({
    connection_id: read_pending_connection_id(request.start_url),
    is_connected: is_connected_app(request.app, connectedApps, request.requested_ms),
    request,
  }));
  const has_rechecked = useConnectionRowRecheck({
    dataUpdatedAt: connections_query.dataUpdatedAt,
    missingConnectionIds: missing_connection_ids(asks, connections),
  });
  const shown_asks = asks.filter(
    ({ connection_id, is_connected, request }) =>
      connection_ask_visibility({
        connection_id,
        connections,
        has_rechecked: connection_id ? has_rechecked(connection_id) : false,
        is_connected,
        list_postdates_ask: list_postdates_ask(
          request.requested_ms,
          connections_query.dataUpdatedAt,
        ),
      }) !== 'hide',
  );

  if (shown_asks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {shown_asks.map(({ connection_id, is_connected, request }) => {
        const icon_url = connection_request_icon_url(request, apps);
        return (
          <ConnectionActionBar
            connectionId={connection_id}
            isConnected={is_connected}
            key={connection_id ?? request.app_key}
            request={request}
            {...(icon_url ? { iconUrl: icon_url } : {})}
          />
        );
      })}
    </div>
  );
}

function missing_connection_ids(
  asks: Array<{ connection_id: string | null }>,
  connections: Connection[] | undefined,
) {
  if (!connections) return [];
  return asks.flatMap(({ connection_id }) =>
    connection_id && !has_connection_row(connections, connection_id) ? [connection_id] : [],
  );
}

function useConnectionRowRecheck({
  dataUpdatedAt,
  missingConnectionIds,
}: {
  dataUpdatedAt: number;
  missingConnectionIds: string[];
}) {
  const query_client = useQueryClient();
  const recheck_started_at = useRef(new Map<string, number>());
  const missing_key = missingConnectionIds.join(',');

  useEffect(() => {
    const missing_ids = missing_key.split(',').filter(Boolean);
    const first_misses = missing_ids.filter((id) => !recheck_started_at.current.has(id));
    if (first_misses.length > 0) {
      for (const id of first_misses) recheck_started_at.current.set(id, dataUpdatedAt);
      void query_client.invalidateQueries({ queryKey: query_keys.connections() });
      return;
    }
    for (const id of missing_ids) {
      const started_at = recheck_started_at.current.get(id);
      if (started_at !== undefined && dataUpdatedAt > started_at) {
        write_connection_ask_postponed(id, false);
      }
    }
  }, [dataUpdatedAt, missing_key, query_client]);

  return (connection_id: string) => {
    const started_at = recheck_started_at.current.get(connection_id);
    return started_at !== undefined && dataUpdatedAt > started_at;
  };
}

type BarPhase = 'shown' | 'fading' | 'gone';

const connection_trust_line = 'Alfera only does what this connection allows. Disconnect anytime.';

// The connect tab publishes back to this one when it lands (connection_setup_return.ts), but that
// broadcast is same-origin, same-device and one-shot, and the connections query is cached for 30s
// with no refetch on focus. A tab closed early — or an app URL on a different host than the one
// chat is open on — would otherwise leave this bar asking forever, so while the reader is mid
// setup we re-read the connections list ourselves until it flips.
const connection_poll_interval_ms = 3_000;
const connection_poll_limit = 40;

const bar_entrance_transition = { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };

function ConnectionActionBar({
  connectionId,
  iconUrl,
  isConnected,
  request,
}: {
  connectionId: string | null;
  iconUrl?: string | undefined;
  isConnected: boolean;
  request: ConnectionRequest;
}) {
  const [was_pending] = useState(!isConnected);
  const [phase, set_phase] = useState<BarPhase>('shown');
  const [has_started_setup, set_has_started_setup] = useState(false);
  const [is_slim, set_is_slim] = useState(() =>
    connectionId ? read_connection_ask_postponed(connectionId) : false,
  );
  const reduce_motion = useReducedMotion();
  const query_client = useQueryClient();

  const postpone_setup = () => {
    set_is_slim(true);
    if (!connectionId) return;
    write_connection_ask_postponed(connectionId, true);
    postpone_connection_setup(connectionId)
      .then(() => query_client.invalidateQueries({ queryKey: query_keys.connections() }))
      .catch(() => {
        write_connection_ask_postponed(connectionId, false);
        set_is_slim(false);
      });
  };

  const cancel_setup = () => {
    set_phase('gone');
    if (!connectionId) return;
    write_connection_ask_postponed(connectionId, false);
    cancel_connection_setup(connectionId)
      .then(() => query_client.invalidateQueries({ queryKey: query_keys.connections() }))
      .catch((error: unknown) => console.error('cancel connection setup failed', error));
  };

  useEffect(() => {
    if (!has_started_setup || isConnected) return;

    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > connection_poll_limit) {
        window.clearInterval(timer);
        return;
      }
      void query_client.invalidateQueries({ queryKey: query_keys.connections() });
    }, connection_poll_interval_ms);
    return () => window.clearInterval(timer);
  }, [has_started_setup, isConnected, query_client]);

  useEffect(() => {
    if (!was_pending || !isConnected) return;
    if (connectionId) write_connection_ask_postponed(connectionId, false);
    const timer = window.setTimeout(() => {
      set_phase(reduce_motion ? 'gone' : 'fading');
    }, connection_receipt_ms);
    return () => window.clearTimeout(timer);
  }, [connectionId, isConnected, reduce_motion, was_pending]);

  if (!was_pending || phase === 'gone') return null;

  const content_kind = connection_bar_content_kind({
    hasStartedSetup: has_started_setup,
    isConnected,
    isSlim: is_slim,
  });

  return (
    <motion.div
      animate={{ opacity: phase === 'fading' ? 0 : 1, y: phase === 'fading' ? 3 : 0 }}
      className="flex items-start gap-[11px] rounded-[14px] border border-border bg-raised px-[14px] py-[13px]"
      initial={reduce_motion ? false : { opacity: 0, y: 4 }}
      transition={
        reduce_motion
          ? { duration: 0 }
          : phase === 'fading'
            ? connection_fade_transition
            : bar_entrance_transition
      }
      onAnimationComplete={() => {
        if (phase === 'fading') set_phase('gone');
      }}
    >
      <ConnectionAppMark iconUrl={iconUrl} name={request.app.app_display_name} />
      {content_kind === 'receipt' ? (
        <ConnectedReceipt name={request.app.app_display_name} />
      ) : content_kind === 'signing_in' ? (
        <ConnectionSigningIn name={request.app.app_display_name} onCancel={cancel_setup} />
      ) : content_kind === 'slim' ? (
        <ConnectionSlimAsk
          name={request.app.app_display_name}
          onCancel={cancel_setup}
          onConnectClick={() => set_has_started_setup(true)}
          startUrl={request.start_url}
        />
      ) : (
        <ConnectionAsk
          name={request.app.app_display_name}
          onConnectClick={() => set_has_started_setup(true)}
          onNotNow={postpone_setup}
          startUrl={request.start_url}
        />
      )}
    </motion.div>
  );
}

export type ConnectionBarContentKind = 'full' | 'receipt' | 'signing_in' | 'slim';

export function connection_bar_content_kind({
  hasStartedSetup,
  isConnected,
  isSlim,
}: {
  hasStartedSetup: boolean;
  isConnected: boolean;
  isSlim: boolean;
}): ConnectionBarContentKind {
  if (isConnected) return 'receipt';
  if (hasStartedSetup) return 'signing_in';
  if (isSlim) return 'slim';
  return 'full';
}

export function read_pending_connection_id(start_url: string) {
  try {
    return new URL(start_url).searchParams.get('connection_id');
  } catch {
    return null;
  }
}

function ConnectionAsk({
  name,
  onConnectClick,
  onNotNow,
  startUrl,
}: {
  name: string;
  onConnectClick: () => void;
  onNotNow: () => void;
  startUrl: string;
}) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] text-foreground">
          Connect <span className="font-semibold">{name}</span> to continue
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{connection_trust_line}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          className="rounded-full px-[15px] py-[9px] text-[13px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          onClick={onNotNow}
          type="button"
        >
          Not now
        </button>
        <ConnectButton startUrl={startUrl} onConnectClick={onConnectClick} />
      </div>
    </>
  );
}

function ConnectionSlimAsk({
  name,
  onCancel,
  onConnectClick,
  startUrl,
}: {
  name: string;
  onCancel: () => void;
  onConnectClick: () => void;
  startUrl: string;
}) {
  return (
    <>
      <div className="min-w-0 flex-1 text-[14.5px] text-foreground">
        Connect <span className="font-semibold">{name}</span> to continue
      </div>
      <ConnectButton startUrl={startUrl} onConnectClick={onConnectClick} />
      <ConnectionDismissButton label={`Dismiss connecting ${name}`} onCancel={onCancel} />
    </>
  );
}

function ConnectionDismissButton({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <button
      aria-label={label}
      className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      onClick={onCancel}
      type="button"
    >
      <X className="size-4" />
    </button>
  );
}

function ConnectButton({
  onConnectClick,
  startUrl,
}: {
  onConnectClick: () => void;
  startUrl: string;
}) {
  return (
    <a
      className="shrink-0 rounded-full bg-foreground px-[15px] py-[9px] text-[13px] font-medium text-background transition-colors hover:bg-foreground/80"
      href={startUrl}
      rel="noreferrer"
      target="_blank"
      onClick={onConnectClick}
    >
      Connect
    </a>
  );
}

function ConnectionSigningIn({ name, onCancel }: { name: string; onCancel: () => void }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] text-foreground">
          Finish signing in with <span className="font-semibold">{name}</span> — this window will
          update by itself.
        </div>
        <ConnectionSigningInSteps appName={name} />
      </div>
      <ConnectionDismissButton label={`Stop connecting ${name}`} onCancel={onCancel} />
    </>
  );
}

function ConnectionSigningInSteps({ appName }: { appName: string }) {
  return (
    <span
      aria-hidden="true"
      className="mt-[9px] flex shrink-0 items-center gap-[9px] text-[11.5px] text-muted-foreground"
    >
      <ConnectionStepDot done /> You
      <ConnectionStepTick />
      <ConnectionStepDot live /> {appName}
      <ConnectionStepTick />
      <ConnectionStepDot /> Alfera
    </span>
  );
}

function ConnectionStepDot({ done = false, live = false }: { done?: boolean; live?: boolean }) {
  return (
    <span
      className={cn(
        'size-[6px] shrink-0 rounded-full',
        live
          ? 'chat-connection-pulse bg-foreground'
          : done
            ? 'bg-muted-foreground/80'
            : 'bg-border',
      )}
    />
  );
}

function ConnectionStepTick() {
  return <span className="h-px w-4 shrink-0 bg-border" />;
}

const connection_fade_transition = { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const };

function ConnectedReceipt({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14.5px] text-foreground">
      <Check aria-hidden="true" className="size-[15px] shrink-0 stroke-[1.5]" />
      {name} connected
    </span>
  );
}

function ConnectionAppMark({ iconUrl, name }: { iconUrl?: string | undefined; name: string }) {
  if (!iconUrl) {
    return (
      <span
        aria-hidden="true"
        className="mt-px size-[17px] shrink-0 text-center text-[11px] leading-[17px] font-medium text-muted-foreground"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="mt-px size-[17px] shrink-0 bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${iconUrl}")` }}
    />
  );
}

export function ConnectionTraceRow({
  app,
  apps,
  isConnected,
}: {
  app: ConnectionSetupApp;
  apps: CatalogApp[];
  isConnected: boolean;
}) {
  const icon_url = app.icon_url ?? catalog_app_icon_url(app.app_name, apps);

  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <ActivityGlyph letter={app.app_display_name} {...(icon_url ? { iconUrl: icon_url } : {})} />
      <span className="min-w-0">
        {isConnected
          ? `Connected ${app.app_display_name}`
          : `${app.app_display_name} connection requested`}
      </span>
    </div>
  );
}

export function latest_connection_requests(
  messages: ProjectedChatMessage[],
  dismissed_app_keys: string[] = [],
): ConnectionRequest[] {
  const last_assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const requests_by_app_key = new Map<string, ConnectionRequest>();

  for (const request of (last_assistant?.parts ?? []).flatMap(connection_request_from_part)) {
    const existing = requests_by_app_key.get(request.app_key);
    requests_by_app_key.set(request.app_key, existing ? join_same_ask(existing, request) : request);
  }

  return [...requests_by_app_key.values()].filter(
    (request) => !dismissed_app_keys.includes(request.app_key),
  );
}

function join_same_ask(existing: ConnectionRequest, next: ConnectionRequest): ConnectionRequest {
  const times = [existing.requested_ms, next.requested_ms].filter(
    (time): time is number => time !== undefined,
  );
  return { ...next, ...(times.length === 0 ? {} : { requested_ms: Math.min(...times) }) };
}

function connection_request_from_part(part: ProjectedChatMessagePart): ConnectionRequest[] {
  if (!is_chat_tool_part(part)) return [];
  const setup = read_connection_setup_tool_output(part.output);
  if (!setup) return [];
  const requested_ms = connection_request_time_ms(part);
  return [
    {
      ...setup,
      app_key: normalize_app_key(setup.app.app_name),
      tool_call_id: part.toolCallId,
      ...(requested_ms === undefined ? {} : { requested_ms }),
    },
  ];
}

export function connection_request_time_ms(part: ProjectedChatToolPart) {
  return read_time_ms(part.createdTime);
}

function read_time_ms(value: string | null | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

export function connected_app_times(connections: Connection[]): ConnectedAppTimes {
  const times: ConnectedAppTimes = {};

  for (const connection of connections) {
    if (connection.connection_status !== 'active') continue;
    const connected_ms = connection_connected_ms(connection);
    for (const key of connection_app_keys(connection)) {
      times[key] = Math.max(times[key] ?? Number.NEGATIVE_INFINITY, connected_ms);
    }
  }

  return times;
}

function connection_app_keys(connection: Connection) {
  return [connection.app_id, connection.app?.app_id, connection.app?.app_name]
    .filter((key): key is string => Boolean(key))
    .map(normalize_app_key);
}

function connection_connected_ms(connection: Connection) {
  return read_time_ms(connection.connected_time) ?? read_time_ms(connection.created_time) ?? 0;
}

const connection_clock_skew_ms = 60_000;

function list_postdates_ask(requested_ms: number | undefined, list_updated_at_ms: number) {
  return requested_ms !== undefined && list_updated_at_ms > requested_ms + connection_clock_skew_ms;
}

export function is_connected_app(
  app: ConnectionSetupApp,
  connected_apps: ConnectedAppTimes,
  requested_ms?: number | undefined,
) {
  return [app.app_id, app.app_name]
    .filter((key): key is string => Boolean(key))
    .map(normalize_app_key)
    .some((key) => {
      const connected_ms = connected_apps[key];
      if (connected_ms === undefined) return false;
      return requested_ms === undefined || connected_ms >= requested_ms - connection_clock_skew_ms;
    });
}

function connection_request_icon_url(request: ConnectionRequest, apps: CatalogApp[]) {
  return request.app.icon_url ?? catalog_app_icon_url(request.app.app_name, apps);
}

function catalog_app_icon_url(app_name: string, apps: CatalogApp[]) {
  const key = normalize_app_key(app_name);
  const app = apps.find((candidate) => normalize_app_key(candidate.app_name) === key);
  return app ? app_icon_url(app) : undefined;
}

export function read_connection_setup_tool_output(
  output: unknown,
): ConnectionSetupToolOutput | null {
  const payload = read_connection_setup_payload(output);
  if (!payload) return null;

  const { app, start_url } = payload;
  const app_name = app?.app_name;
  const app_display_name = app?.app_display_name;
  if (!start_url || !app_name || !app_display_name) return null;

  return {
    app: {
      app_name,
      app_display_name,
      ...(app.app_id ? { app_id: app.app_id } : {}),
      ...(app.description ? { description: app.description } : {}),
      ...(app.icon_url ? { icon_url: app.icon_url } : {}),
    },
    start_url,
  };
}

function read_connection_setup_payload(output: unknown): ConnectionSetupPayload | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;

  const record = output as ConnectionSetupPayload;
  if (record.type === 'connection_setup') return record;

  if (record.data?.type === 'connection_setup') return record.data;

  if (record.content_json?.type === 'connection_setup') return record.content_json;

  return read_content_block_payload(record.content);
}

function read_content_block_payload(content: unknown): ConnectionSetupPayload | null {
  if (!Array.isArray(content)) return null;

  for (const candidate of content) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const block = candidate as { text?: unknown };
    if (typeof block.text !== 'string' || !block.text.includes('connection_setup')) continue;

    const payload = read_connection_setup_payload(parse_json(block.text));
    if (payload) return payload;
  }
  return null;
}

function parse_json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
