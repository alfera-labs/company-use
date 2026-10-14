import {
  decide_whether_to_fetch,
  is_blocked_address,
} from '@coworker/core/credentials/safe_outbound_url';
import { describe, expect, it } from 'vitest';

const allowed_hosts = ['www.acmebooking.com'];
const resolves_to =
  (...addresses: string[]) =>
  async () =>
    addresses;

async function decide(url: string, lookup = resolves_to('93.184.216.34')) {
  return decide_whether_to_fetch({ url, allowed_hosts, lookup_addresses: lookup });
}

describe('decide_whether_to_fetch', () => {
  it('allows the site the connection actually belongs to', async () => {
    expect(await decide('https://www.acmebooking.com/api/account/signin')).toEqual({
      may_fetch: true,
      host: 'www.acmebooking.com',
    });
  });

  it('refuses a host the connection never declared', async () => {
    const verdict = await decide('https://attacker.example/collect');
    expect(verdict).toMatchObject({ may_fetch: false });
    expect((verdict as { because: string }).because).toContain('not one of the websites');
  });

  it.each([
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://metadata.goog/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1:5432/',
    'https://10.1.2.3/admin',
    'https://[::1]/',
  ])('refuses %s by name or address', async (url) => {
    expect(await decide(url)).toMatchObject({ may_fetch: false });
  });

  it('refuses an allowed name that resolves into our network', async () => {
    const verdict = await decide(
      'https://www.acmebooking.com/api/account/signin',
      resolves_to('169.254.169.254'),
    );
    expect(verdict).toMatchObject({ may_fetch: false });
    expect((verdict as { because: string }).because).toContain('inside our network');
  });

  it('refuses when only ONE of several answers is internal', async () => {
    expect(
      await decide('https://www.acmebooking.com/signin', resolves_to('93.184.216.34', '10.0.0.7')),
    ).toMatchObject({ may_fetch: false });
  });

  it('refuses a name that does not resolve at all', async () => {
    expect(await decide('https://www.acmebooking.com/x', resolves_to())).toMatchObject({
      may_fetch: false,
    });
  });

  it('refuses http, however ordinary the host looks', async () => {
    expect(await decide('http://www.acmebooking.com/signin')).toMatchObject({ may_fetch: false });
  });

  it('refuses something that is not a web address', async () => {
    expect(await decide('file:///etc/passwd')).toMatchObject({ may_fetch: false });
    expect(await decide('not a url')).toMatchObject({ may_fetch: false });
  });

  it('is not fooled by a trailing dot or odd casing', async () => {
    expect(await decide('https://WWW.AcmeBooking.com./signin')).toMatchObject({ may_fetch: true });
  });
});

describe('is_blocked_address', () => {
  it.each([
    '169.254.169.254',
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '::1',
    '100.64.0.1',
    '224.0.0.1',
  ])('blocks %s', (address) => expect(is_blocked_address(address)).toBe(true));

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '2606:2800:220:1:248:1893:25c8:1946',
  ])('allows the public address %s', (address) => expect(is_blocked_address(address)).toBe(false));

  it('is not confused by a hostname', () => {
    expect(is_blocked_address('www.acmebooking.com')).toBe(false);
  });
});
