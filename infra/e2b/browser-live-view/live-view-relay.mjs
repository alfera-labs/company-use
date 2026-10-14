import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
// Import ws by package name, not by file path: ws is CommonJS, and Node's named-export detection
// works through the package specifier but not a direct path import. This file is baked at
// /opt/coworker/browser/live-view-relay.mjs with ws installed at
// /opt/coworker/browser/node_modules/ws, so the bare specifier resolves.
import { WebSocket, WebSocketServer } from 'ws';

const RELAY_PORT = process.env.LIVE_VIEW_RELAY_PORT || '4820';
const UPSTREAM_PORT = process.env.AGENT_BROWSER_STREAM_PORT || '4849';
const TOKEN = process.env.AGENT_BROWSER_LIVE_VIEW_TOKEN;
const pointer_prefix = '__alfera_pointer ';
// Messages the app may push straight through to agent-browser's stream server.
const passthrough_types = new Set(['input_mouse', 'input_keyboard', 'input_touch', 'config', 'ack']);

// The browser chrome (tabs, address bar) needs real browser operations, which are not input
// events. Each one maps to exactly one agent-browser command. The relay inherits the session's
// env (AGENT_BROWSER_SESSION and friends), so these reach the same daemon the agent drives.
// Anything not in this table is refused: the app can never run an arbitrary command here.
const control_actions = {
  back: () => ['back'],
  forward: () => ['forward'],
  reload: () => ['reload'],
  navigate: ({ url }) => (is_web_url(url) ? ['open', url] : null),
  tab_new: ({ url }) => (url === undefined ? ['tab', 'new'] : is_web_url(url) ? ['tab', 'new', url] : null),
  tab_switch: ({ tab_id }) => (is_tab_id(tab_id) ? ['tab', tab_id] : null),
  tab_close: ({ tab_id }) => (is_tab_id(tab_id) ? ['tab', 'close', tab_id] : null),
};
const control_timeout_ms = 30_000;
let tabs_refresh_timer = null;
let tabs_refresh_running = false;
let tabs_refresh_requested = false;

function is_web_url(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function is_tab_id(value) {
  return typeof value === 'string' && /^t\d{1,6}$/.test(value);
}

function log_error(error) {
  console.error('[live-view-relay]', error);
}

function guard_handler(handler) {
  return (...arguments_list) => {
    try {
      handler(...arguments_list);
    } catch (error) {
      log_error(error);
    }
  };
}

process.on('uncaughtException', log_error);
process.on('unhandledRejection', log_error);

function send_text(socket, text) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(text, { binary: false }, (error) => {
    if (error) log_error(error);
  });
}

function translate_console_message(message) {
  if (typeof message.text !== 'string' || !message.text.startsWith(pointer_prefix)) return;
  try {
    const { kind, x, y, name } = JSON.parse(message.text.slice(pointer_prefix.length));
    return JSON.stringify({
      type: 'pointer', kind, x, y, name, timestamp: message.timestamp ?? Date.now(),
    });
  } catch (error) {
    log_error(error);
  }
}

function forward_downstream(connection, data, is_binary) {
  if (is_binary) return;
  const text = data.toString();
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    send_text(connection.client, text);
    return;
  }
  if (message?.type === 'url' && typeof message.url === 'string' && connection.last_url !== message.url) {
    connection.last_url = message.url;
    request_tabs_refresh();
  }
  if (message?.type === 'console') {
    const translated = translate_console_message(message);
    if (translated !== undefined) send_text(connection.client, translated);
    return;
  }
  send_text(connection.client, text);
}

// URL events lack tab identity. Read the tab list after each navigation burst.
// All viewers share this refresh, so duplicate events do not start duplicate commands.
function request_tabs_refresh() {
  tabs_refresh_requested = true;
  if (tabs_refresh_timer || tabs_refresh_running) return;
  tabs_refresh_timer = setTimeout(guard_handler(refresh_tabs), 250);
}

function refresh_tabs() {
  tabs_refresh_timer = null;
  tabs_refresh_requested = false;
  if (websocket_server.clients.size === 0) return;
  tabs_refresh_running = true;
  execFile('agent-browser', ['tab'], { env: process.env, timeout: control_timeout_ms }, (error) => {
    tabs_refresh_running = false;
    if (error) {
      log_error(error);
      const reply = JSON.stringify({
        type: 'control_result', id: null, action: 'tab_list', ok: false,
        error: 'Could not refresh the browser address.',
      });
      for (const client of websocket_server.clients) send_text(client, reply);
    }
    if (tabs_refresh_requested) request_tabs_refresh();
  });
}

// Run one allowlisted agent-browser command for the app and answer with its outcome. No shell:
// execFile passes argv straight to the binary, so a URL or id can never smuggle in a second
// command. The reply carries the request id so the app can match it.
function run_control(connection, message) {
  const build = control_actions[message.action];
  const argv = build ? build(message) : null;
  const reply = (body) =>
    send_text(connection.client, JSON.stringify({ type: 'control_result', id: message.id ?? null, action: message.action, ...body }));
  if (!argv) {
    reply({ ok: false, error: message.action === 'navigate' ? 'Enter a valid website address.' : `Unsupported or invalid control: ${String(message.action)}` });
    return;
  }
  execFile('agent-browser', argv, { env: process.env, timeout: control_timeout_ms }, (error, stdout, stderr) => {
    if (error) {
      reply({ ok: false, error: (stderr || error.message || 'command failed').trim().slice(0, 500) });
      return;
    }
    reply({ ok: true, output: String(stdout).trim().slice(0, 500) });
  });
}

function forward_upstream(connection, data, is_binary) {
  if (is_binary || connection.client.readyState !== WebSocket.OPEN) return;
  const text = data.toString();
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message?.type === 'control') {
    run_control(connection, message);
    return;
  }
  if (!passthrough_types.has(message?.type)) return;
  connection.messages.push(text);
  if (connection.messages.length > 100) connection.messages.shift();
  flush_buffer(connection);
}

function flush_buffer(connection) {
  while (connection.upstream?.readyState === WebSocket.OPEN && connection.messages.length > 0) {
    send_text(connection.upstream, connection.messages[0]);
    connection.messages.shift();
  }
}

function schedule_reconnect(connection) {
  if (connection.client.readyState !== WebSocket.OPEN || connection.reconnect_timer) return;
  connection.reconnect_timer = setTimeout(guard_handler(() => {
    connection.reconnect_timer = null;
    connect_upstream(connection);
  }), connection.retry_delay);
  connection.retry_delay = Math.min(connection.retry_delay * 2, 2000);
}

function disconnect_upstream(connection, upstream) {
  // An old socket can emit close after its replacement starts connecting.
  if (connection.upstream !== upstream) return;
  connection.upstream = null;
  send_text(connection.client, JSON.stringify({ type: 'status', connected: false, screencasting: false }));
  schedule_reconnect(connection);
  if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
}

function connect_upstream(connection) {
  if (connection.client.readyState !== WebSocket.OPEN) return;
  try {
    const upstream = new WebSocket(`ws://127.0.0.1:${UPSTREAM_PORT}/`, {
      origin: 'http://127.0.0.1',
      headers: { origin: 'http://127.0.0.1' },
    });
    connection.upstream = upstream;
    upstream.on('open', guard_handler(() => {
      if (connection.upstream !== upstream || connection.client.readyState !== WebSocket.OPEN) {
        upstream.close();
        return;
      }
      connection.retry_delay = 250;
      flush_buffer(connection);
    }));
    upstream.on('message', guard_handler((data, is_binary) => {
      if (connection.upstream === upstream) forward_downstream(connection, data, is_binary);
    }));
    upstream.on('close', guard_handler(() => disconnect_upstream(connection, upstream)));
    upstream.on('error', guard_handler((error) => {
      log_error(error);
      disconnect_upstream(connection, upstream);
    }));
  } catch (error) {
    log_error(error);
    send_text(connection.client, JSON.stringify({ type: 'status', connected: false, screencasting: false }));
    schedule_reconnect(connection);
  }
}

function close_connection(connection) {
  clearTimeout(connection.reconnect_timer);
  connection.reconnect_timer = null;
  connection.messages.length = 0;
  const upstream = connection.upstream;
  connection.upstream = null;
  if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
  else if (upstream?.readyState === WebSocket.OPEN) upstream.close();
}

function accept_client(client) {
  const connection = { client, upstream: null, messages: [], reconnect_timer: null, retry_delay: 250, last_url: null };
  client.on('message', guard_handler((data, is_binary) => forward_upstream(connection, data, is_binary)));
  client.on('close', guard_handler(() => close_connection(connection)));
  client.on('error', log_error);
  connect_upstream(connection);
}

const websocket_server = new WebSocketServer({ noServer: true });
websocket_server.on('error', log_error);

function handle_upgrade(request, socket, head) {
  socket.on('error', log_error);
  let supplied_token;
  try {
    supplied_token = new URL(request.url, 'http://127.0.0.1').searchParams.get('token');
  } catch {
    supplied_token = null;
  }
  if (!TOKEN || supplied_token !== TOKEN) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  websocket_server.handleUpgrade(request, socket, head, guard_handler(accept_client));
}

const server = createServer((request, response) => {
  const pathname = request.url?.split('?')[0];
  const healthy = request.method === 'GET' && (pathname === '/' || pathname === '/healthz');
  response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'text/plain' });
  response.end(healthy ? 'ok' : 'Not Found');
});
server.on('upgrade', guard_handler(handle_upgrade));
server.on('error', log_error);
server.listen(Number(RELAY_PORT), '0.0.0.0', () => {
  console.log('[live-view-relay] listening on ' + RELAY_PORT);
});
