import {
  build_dependencies,
  create_offline_sender,
  create_recording_sender,
  secret_token,
  start_local_server,
} from '@connectors/__tests__/local_file_server';
import { fetch_connector_file } from '@connectors/runtime/fetch_connector_file';
import { describe, expect, it } from 'vitest';

const slack_policy = { allowed_hosts: ['*.slack.com'], base_url_host: 'slack.com' };

describe('fetch_connector_file: hostile urls make zero requests', () => {
  it.each([
    'https://evil-slack.com/f',
    'https://evilslack.com/f',
    'https://slack.com@evil.com/f',
    'https://files.slack.com:443@evil.com/f',
    'https://files.slack.com.evil.com/f',
    'https://evil.com#.slack.com',
    'https://evil.com?.slack.com',
    'https://evil.com/.slack.com',
    'https://evil.com\\.slack.com',
    'https://slаck.com/f',
    'https://files.slack.com。evil.com/f',
    'https://files.slack.com:8443/f',
    'http://files.slack.com/f',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'ftp://files.slack.com/f',
    'javascript:alert(1)',
    'https://127.0.0.1/f',
    'https://0x7f000001/f',
    'https://[::1]/f',
  ])('%s -> host_refused', async (url) => {
    const sender = create_offline_sender();
    const result = await fetch_connector_file(build_dependencies(slack_policy, sender), {
      url,
      headers: { Authorization: secret_token },
    });
    expect(result).toEqual({ outcome: 'host_refused' });
    expect(sender.sent_urls).toEqual([]);
  });

  it('refuses a lookalike suffix against a live server', async () => {
    const target = await start_local_server((_request, response) => response.end('stolen'), {
      hostname: '127.0.0.1',
    });
    const policy = {
      allowed_hosts: [`http://*.27.0.0.1:${target.port}`],
      base_url_host: 'x.invalid',
    };
    const sender = create_recording_sender();
    const result = await fetch_connector_file(build_dependencies(policy, sender), {
      url: `${target.url}/f`,
      headers: { Authorization: secret_token },
    });
    await target.stop();
    expect(result).toEqual({ outcome: 'host_refused' });
    expect(sender.sent_urls).toEqual([]);
    expect(target.hits.length).toBe(0);
  });
});
