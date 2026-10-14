import {
  AddressNotReachedError,
  fetch_outside_address,
  find_reason_not_to_reach,
} from '@coworker/core/credentials/resolve_host_addresses';
import {
  decide_whether_to_fetch,
  is_blocked_address,
  is_blocked_host,
  is_blocked_host_name,
} from '@coworker/core/credentials/safe_outbound_url';
import { find_website_icon } from '@coworker/core/credentials/website_icon';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resolves_to =
  (...addresses: string[]) =>
  async () =>
    addresses;
const a_public_address = '93.184.216.34';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a host our own processes must not send a request to', () => {
  it.each([
    'api',
    'app',
    'engine',
    'postgres',
    'worker',
    'localhost',
    'db.localhost',
    'host.docker.internal',
    'metadata.goog',
    'metadata.google.internal',
    'printer.local',
    'nas.lan',
    '2130706433',
  ])('is the name %s: a service of the install, this machine, or a local network', (name) => {
    expect(is_blocked_host_name(name)).toBe(true);
    expect(is_blocked_host(name)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.20.0.3',
    '192.168.1.20',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '[::ffff:ac14:3]',
    'fd00::5',
    'fe80::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
  ])('is the address %s: loopback, private, link-local or one that carries such an address', (address) => {
    expect(is_blocked_address(address)).toBe(true);
    expect(is_blocked_host(address)).toBe(true);
  });

  it.each([
    'example.com',
    'api.example.com',
    '93.184.216.34',
    '2606:2800:220:1::',
  ])('is not the public host %s', (host) => {
    expect(is_blocked_host(host)).toBe(false);
  });

  it.each([
    'https://postgres/',
    'https://api:3001/v1/team',
    'https://host.docker.internal:3000/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:a9fe:a9fe]/latest/meta-data/',
    'https://2130706433/',
  ])('is refused in %s before any lookup, even when the host is the allowed one', async (url) => {
    const lookup = vi.fn(resolves_to(a_public_address));
    const verdict = await decide_whether_to_fetch({
      url,
      allowed_hosts: [new URL(url).hostname],
      lookup_addresses: lookup,
    });
    expect(verdict).toMatchObject({ may_fetch: false });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('a request to an address somebody handed us', () => {
  it('is let through for a public name, and refused for http, an inside name, or an inside answer', async () => {
    const to_public = resolves_to(a_public_address);
    expect(await find_reason_not_to_reach('https://mcp.example.com/mcp', to_public)).toBeNull();
    expect(await find_reason_not_to_reach('http://mcp.example.com/mcp', to_public)).toContain(
      'https',
    );
    expect(await find_reason_not_to_reach('https://engine:6420/', to_public)).toContain(
      'not a public address',
    );
    expect(
      await find_reason_not_to_reach('https://mcp.example.com/mcp', resolves_to('172.20.0.3')),
    ).toContain('inside our network');
    expect(await find_reason_not_to_reach('not an address', to_public)).not.toBeNull();
  });

  it('is not sent at all when the address is refused', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    await expect(
      fetch_outside_address('https://postgres:5432/token', { method: 'POST' }),
    ).rejects.toBeInstanceOf(AddressNotReachedError);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('the icon of a website, asked for by our own server', () => {
  const moved = (location: string) => new Response(null, { status: 302, headers: { location } });
  const an_icon = () =>
    new Response('icon', { status: 200, headers: { 'content-type': 'image/png' } });

  it('is not followed to an address inside the network', async () => {
    const send = vi.fn().mockResolvedValueOnce(moved('https://169.254.169.254/latest/meta-data/'));

    const icon = await find_website_icon({
      host: 'www.example.com',
      send_request: send,
      lookup_addresses: resolves_to(a_public_address),
    });

    expect(icon).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('is not followed to a name that resolves inside the network', async () => {
    const send = vi.fn().mockResolvedValueOnce(moved('https://cdn.example.com/favicon.ico'));
    const lookup = async (host: string) => [
      host === 'cdn.example.com' ? '10.0.0.7' : a_public_address,
    ];

    const icon = await find_website_icon({
      host: 'www.example.com',
      send_request: send,
      lookup_addresses: lookup,
    });

    expect(icon).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('is still found behind a redirect to a public address', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(moved('https://example.com/favicon.ico'))
      .mockResolvedValueOnce(an_icon());

    const icon = await find_website_icon({
      host: 'www.example.com',
      send_request: send,
      lookup_addresses: resolves_to(a_public_address),
    });

    expect(icon).toBe('https://www.example.com/favicon.ico');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
