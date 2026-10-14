import { describe, expect, it } from 'vitest';
import { drop_control_flow_throws_and_scrub_secrets } from '@/lib/sentry_control_flow';
import { scrub_sign_in_links, scrub_sign_in_links_in_report } from '@/lib/sign_in_link_scrub';

const token = `${'aB3_'.repeat(10)}xyZ`;
const link = `http://192.168.1.10:3000/join/${token}`;

describe('a sign-in link in an error report', () => {
  it('loses its token wherever the address is held', () => {
    const report = {
      request: { url: link, headers: { referer: link } },
      transaction: `GET /join/${token}`,
      breadcrumbs: [{ data: { url: link, to: `/join/${token}?x=1` }, message: `open ${link}` }],
      spans: [{ data: { 'url.full': link } }],
      exception: { values: [{ value: `fetch failed for ${link}` }] },
    };

    const scrubbed = JSON.stringify(scrub_sign_in_links_in_report(report));

    expect(scrubbed).not.toContain(token);
    expect(scrubbed.match(/\/join\/\[link\]/gu)).toHaveLength(8);
  });

  it('is scrubbed by the hook the server gives the error reporter', () => {
    const event = { request: { url: `${link}?x=1`, headers: { cookie: 'a=b' } }, message: link };
    const sent = drop_control_flow_throws_and_scrub_secrets(event, {});
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(sent?.request.url).toBe('http://192.168.1.10:3000/join/[link]');
  });

  it('leaves every other address as it is, a short referral code too', () => {
    const other_addresses = [
      '/join',
      '/join/abc123',
      '/join/ws_1234',
      `/join/ws_${'a'.repeat(60)}`,
      '/chats/ses_1',
      'https://example.com/a?b=c',
    ];
    for (const address of other_addresses) {
      expect(scrub_sign_in_links(address)).toBe(address);
    }
  });

  it('copes with a report that holds itself', () => {
    const report: { self?: unknown; url: string } = { url: link };
    report.self = report;
    expect(scrub_sign_in_links_in_report(report).url).toBe('http://192.168.1.10:3000/join/[link]');
  });
});
