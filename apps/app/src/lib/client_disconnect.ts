// A browser that drops a request mid-flight (reload, navigation, cancelled preload, closed
// stream) makes TanStack Start rethrow `request.signal.reason`, and h3 logs any rejection that is
// not an HTTPError as an unhandled 500 — one block per abandoned request. h3 recognizes an
// HTTPError by `error.name` alone, so an abort reason that carries that name and status 499
// makes a client hangup answer quietly, the way h3's own proxy() and srvx already do.
// Upstream: TanStack/router issue 7991. Both hooks are undocumented; drop this file once Start
// classifies disconnects itself.

export class ClientDisconnected extends Error {
  readonly status = 499;
  readonly statusText = 'Client Closed Request';

  constructor() {
    super('The client closed the connection before the response finished');
    this.name = 'HTTPError';
  }

  toJSON() {
    return { status: this.status, statusText: this.statusText };
  }
}

// Replaces `request.signal` with one that aborts with ClientDisconnected whenever the original
// aborts. Redefined on the instance instead of rebuilt with `new Request(...)`, which would drop
// what the node adapter hangs off the object.
export function relay_client_disconnect(request: Request): void {
  const original = request.signal;
  const relayed = new AbortController();
  const relay = () => relayed.abort(new ClientDisconnected());
  if (original.aborted) relay();
  else original.addEventListener('abort', relay, { once: true });
  Object.defineProperty(request, 'signal', { get: () => relayed.signal, configurable: true });
}
