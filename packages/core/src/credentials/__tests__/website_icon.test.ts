import { find_website_icon, is_safe_icon_url } from '@coworker/core/credentials/website_icon';
import { describe, expect, it, vi } from 'vitest';

function answer(status: number, content_type: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => content_type },
  } as unknown as Response;
}

const lookup_addresses = async () => ['93.184.216.34'];

describe('find_website_icon', () => {
  it('returns the favicon when the site actually serves an image', async () => {
    const send = vi.fn().mockResolvedValue(answer(200, 'image/jpeg'));

    expect(
      await find_website_icon({
        host: 'www.acmebooking.com',
        send_request: send,
        lookup_addresses,
      }),
    ).toBe('https://www.acmebooking.com/favicon.ico');
  });

  it('returns nothing when the site has no favicon', async () => {
    const send = vi.fn().mockResolvedValue(answer(404, 'text/html'));

    expect(
      await find_website_icon({ host: 'example.com', send_request: send, lookup_addresses }),
    ).toBeNull();
  });

  it('returns nothing when the answer is a page rather than an image', async () => {
    const send = vi.fn().mockResolvedValue(answer(200, 'text/html; charset=utf-8'));

    expect(
      await find_website_icon({ host: 'example.com', send_request: send, lookup_addresses }),
    ).toBeNull();
  });

  it('returns nothing rather than raising when the site is unreachable', async () => {
    const send = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    expect(
      await find_website_icon({ host: 'nowhere.invalid', send_request: send, lookup_addresses }),
    ).toBeNull();
  });

  it('refuses a host that resolves to a loopback address', async () => {
    const send = vi.fn().mockResolvedValue(answer(200, 'image/png'));

    const icon = await find_website_icon({
      host: 'icons.example.test',
      send_request: send,
      lookup_addresses: async () => ['127.0.0.1'],
    });

    expect(icon).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('never asks a third party, only the site being connected', async () => {
    const send = vi.fn().mockResolvedValue(answer(200, 'image/png'));
    await find_website_icon({ host: 'www.acmebooking.com', send_request: send, lookup_addresses });

    expect(send.mock.calls[0]?.[0]).toBe('https://www.acmebooking.com/favicon.ico');
  });
});

describe('is_safe_icon_url', () => {
  it('allows an https logo on another host', () => {
    expect(is_safe_icon_url('https://cdn-static.acmebooking.com/static/images/mark.png')).toBe(
      true,
    );
  });

  it.each([
    'http://www.acmebooking.com/favicon.ico',
    'https://127.0.0.1/icon.png',
    'https://169.254.169.254/icon.png',
    'https://10.0.0.5/icon.png',
    'not a url',
  ])('refuses %s', (url) => expect(is_safe_icon_url(url)).toBe(false));
});
