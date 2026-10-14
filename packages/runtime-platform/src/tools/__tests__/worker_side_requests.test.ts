import { McpTransportError, send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';
import {
  fetch_public_url,
  PublicUrlPolicyError,
  public_http_url,
} from '@runtime-platform/tools/public_url_fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ answers: new Map<string, string[]>() }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) =>
    (dns.answers.get(hostname) ?? ['93.184.216.34']).map((address) => ({ address })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  dns.answers.clear();
});

describe('a page or a file the worker itself fetches for the coworker', () => {
  it.each([
    'http://api:3001/health',
    'http://app:3000/',
    'http://engine:6420/',
    'http://postgres:5432/',
    'http://worker/',
    'http://localhost:3001/',
    'http://host.docker.internal:3000/',
    'http://127.0.0.1:3001/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://[::1]:3001/',
    'http://[::ffff:7f00:1]:3001/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
  ])('is refused at %s, and no request is sent', async (url) => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    await expect(fetch_public_url(url)).rejects.toBeInstanceOf(PublicUrlPolicyError);

    expect(send).not.toHaveBeenCalled();
  });

  it('is refused when a public-looking name resolves to a service of the install', async () => {
    dns.answers.set('files.example.com', ['93.184.216.34', '172.20.0.3']);

    await expect(public_http_url('https://files.example.com/report.pdf')).rejects.toThrow(
      'private or reserved',
    );
  });

  it.each([
    'http://postgres:5432/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:7f00:1]:3001/',
    'https://moved.example.com/inside',
  ])('is not followed when a public site redirects to %s', async (target) => {
    dns.answers.set('moved.example.com', ['10.0.0.7']);
    const send = vi.fn(
      async () => new Response('', { status: 302, headers: { location: target } }),
    );
    vi.stubGlobal('fetch', send);

    await expect(fetch_public_url('https://www.example.com/start')).rejects.toBeInstanceOf(
      PublicUrlPolicyError,
    );

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('a call to an MCP server whose address was checked when it was added', () => {
  const call = (endpoint_url: string) =>
    send_mcp_request({ endpoint_url, headers: {} }, { id: 1, method: 'tools/list' });

  it('is not sent when the name now resolves inside the network', async () => {
    dns.answers.set('mcp.example.com', ['172.20.0.3']);
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    await expect(call('https://mcp.example.com/mcp')).rejects.toBeInstanceOf(McpTransportError);
    await expect(call('https://mcp.example.com/mcp')).rejects.toThrow(
      'points to a private address',
    );

    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    'https://api:3001/mcp',
    'http://mcp.example.com/mcp',
    'https://169.254.169.254/',
  ])('is not sent to %s', async (endpoint_url) => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    await expect(call(endpoint_url)).rejects.toBeInstanceOf(McpTransportError);

    expect(send).not.toHaveBeenCalled();
  });
});
