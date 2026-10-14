import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { follow_same_site_redirect } from '@runtime-platform/connections/mcp_endpoint_admission';
import { McpTransportError, send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const moves: Record<string, string> = { '/mcp': '/mcp/', '/elsewhere': 'https://example.org/mcp' };
const server = createServer((request, response) => {
  const moved_to = moves[request.url ?? ''];
  if (moved_to) response.writeHead(307, { location: moved_to }).end();
  else response.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
});
let origin = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('an MCP server address that redirects', () => {
  it('is saved at the address its own site redirects to', async () => {
    await expect(follow_same_site_redirect(`${origin}/mcp`)).resolves.toBe(`${origin}/mcp/`);
  });

  it('is kept as typed when the redirect leaves the site', async () => {
    await expect(follow_same_site_redirect(`${origin}/elsewhere`)).resolves.toBe(
      `${origin}/elsewhere`,
    );
  });

  it('is kept as typed when the server answers without a redirect or not at all', async () => {
    await expect(follow_same_site_redirect(`${origin}/mcp/`)).resolves.toBe(`${origin}/mcp/`);
    await expect(follow_same_site_redirect('http://127.0.0.1:9/mcp')).resolves.toBe(
      'http://127.0.0.1:9/mcp',
    );
  });

  it('tells the person where the server moved when a saved address redirects', async () => {
    const saved_address = 'https://mcp.example.test/mcp';
    const moved = new Response(null, { status: 308, headers: { location: '/mcp/' } });
    vi.stubGlobal('fetch', async () => moved.clone());
    const request = send_mcp_request(
      { endpoint_url: saved_address, headers: {} },
      { id: 1, method: 'ping' },
    );
    await expect(request).rejects.toThrow(McpTransportError);
    await expect(request).rejects.toThrow(
      `The MCP server moved to ${saved_address}/. Add the server again with that address.`,
    );
    vi.unstubAllGlobals();
  });

  it('sends nothing to a saved address on this machine', async () => {
    const request = send_mcp_request(
      { endpoint_url: `${origin}/mcp`, headers: {} },
      { id: 1, method: 'ping' },
    );
    await expect(request).rejects.toThrow(/No request was sent to the MCP server/u);
  });
});
