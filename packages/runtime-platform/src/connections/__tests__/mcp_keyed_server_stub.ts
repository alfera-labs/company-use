import { vi } from 'vitest';

export const good_api_key = 'good-api-key';
export const good_token = 'good-token';

const one_tool = [{ name: 'read_note', description: 'Read a note', inputSchema: {} }];

/**
 * An MCP server that answers 401 to a request with no credential and offers no sign-in. It
 * takes the key under X-Api-Key, or the token as a bearer token.
 */
export function stub_keyed_mcp_server(server_name = 'KeyedNotes', tools: unknown[] = one_tool) {
  const send = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const holds_a_credential =
      headers.get('x-api-key') === good_api_key ||
      headers.get('authorization') === `Bearer ${good_token}`;
    if (!holds_a_credential) return new Response('{"error":"unauthorized"}', { status: 401 });

    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: server_name, version: '1.0.0' },
        },
      });
    }
    if (body.method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools },
      });
    }
    return new Response(null, { status: 202 });
  });
  vi.stubGlobal('fetch', send);
  return send;
}
