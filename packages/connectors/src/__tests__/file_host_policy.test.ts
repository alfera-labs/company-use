import { find_json_schema_violation } from '@connectors/json_schema_validation';
import type { FileHostPolicy } from '@connectors/sync/file_host_policy';
import { is_file_url_allowed, is_protocol_downgrade } from '@connectors/sync/file_host_policy';
import { sync_file_fetch_schema } from '@connectors/sync_definition/sync_extension_schemas';
import { describe, expect, it } from 'vitest';

const slack_policy: FileHostPolicy = {
  allowed_hosts: ['*.slack.com', 'files.example.org'],
  base_url_host: 'slack.com',
};

function allows(policy: FileHostPolicy, url: string) {
  return is_file_url_allowed(policy, new URL(url));
}

describe('is_file_url_allowed: hosts', () => {
  it.each([
    'https://files.slack.com/f',
    'https://FILES.SLACK.COM/f',
    'https://files.slack.com./f',
    'https://slack.com/f',
    'https://a.b.slack.com/f',
    'https://files.example.org/f',
    'https://files.slack.com:443/f',
  ])('allows %s', (url) => {
    expect(allows(slack_policy, url)).toBe(true);
  });

  it.each([
    'https://evil-slack.com/f',
    'https://evilslack.com/f',
    'https://slack.com.evil.com/f',
    'https://files.slack.com.evil.com/f',
    'https://xn--slck-6qa.com/f',
    'https://slack.co/f',
    'https://127.0.0.1/f',
    'https://[::1]/f',
    'https://files.slack.com../f',
    'https://example.org/f',
    'https://sub.files.example.org/f',
  ])('refuses %s', (url) => {
    expect(allows(slack_policy, url)).toBe(false);
  });

  it('never reads a raw *slack.com entry as a glob', () => {
    const policy = { allowed_hosts: ['*slack.com'], base_url_host: 'x.invalid' };
    expect(allows(policy, 'https://evilslack.com/f')).toBe(false);
    expect(allows(policy, 'https://files.slack.com/f')).toBe(false);
  });

  it('ignores a wildcard over a single label', () => {
    const policy = { allowed_hosts: ['*.com', '*..', '*.'], base_url_host: 'x.invalid' };
    expect(allows(policy, 'https://evil.com/f')).toBe(false);
    expect(allows(policy, 'https://com/f')).toBe(false);
  });

  it.each([
    '*.co.uk',
    '*.github.io',
    '*.vercel.app',
    '*.s3.amazonaws.com',
  ])('refuses a wildcard whose base %s is a public suffix', (wildcard_host) => {
    const policy = { allowed_hosts: [wildcard_host], base_url_host: 'x.invalid' };
    const base = wildcard_host.slice(2);
    expect(allows(policy, `https://anything.${base}/f`)).toBe(false);
  });

  it.each([
    '*.slack.com',
    '*.googleusercontent.com',
  ])('still allows the legitimate wildcard %s', (wildcard_host) => {
    const policy = { allowed_hosts: [wildcard_host], base_url_host: 'x.invalid' };
    const base = wildcard_host.slice(2);
    expect(allows(policy, `https://anything.${base}/f`)).toBe(true);
  });
});

describe('is_file_url_allowed: wildcard attack hosts', () => {
  it.each([
    ['*.amazonaws.com', 'https://attacker-bucket.s3.amazonaws.com/x'],
    ['*.amazonaws.com', 'https://attacker.execute-api.us-east-1.amazonaws.com/x'],
    ['*.windows.net', 'https://attacker.blob.core.windows.net/x'],
    ['*.core.windows.net', 'https://attacker.blob.core.windows.net/x'],
    ['*.us-east-1.amazonaws.com', 'https://attacker.s3.us-east-1.amazonaws.com/x'],
    ['*.0.1', 'https://45.33.0.1/x'],
    ['*.168.1.1', 'https://192.168.1.1/x'],
    ['*.1.1.1', 'https://1.1.1.1/x'],
    ['*.co.uk', 'https://attacker.co.uk/x'],
    ['*.github.io', 'https://attacker.github.io/x'],
    ['*.vercel.app', 'https://attacker.vercel.app/x'],
    ['*.herokuapp.com', 'https://attacker.herokuapp.com/x'],
    ['*.s3.amazonaws.com', 'https://attacker.s3.amazonaws.com/x'],
    ['*.cloudfront.net', 'https://attacker.cloudfront.net/x'],
    ['*.xn--p1ai', 'https://attacker.xn--p1ai/x'],
    ['*.localhost', 'https://attacker.localhost/x'],
    ['*.blogspot.com', 'https://attacker.blogspot.com/x'],
    ['*.appspot.com', 'https://attacker.appspot.com/x'],
    ['*.myshopify.com', 'https://attacker.myshopify.com/x'],
    ['*.googleapis.com', 'https://attacker.googleapis.com/x'],
    ['*.githubusercontent.com', 'https://attacker.githubusercontent.com/x'],
    ['*.blob.core.windows.net', 'https://attacker.blob.core.windows.net/x'],
    ['*.r2.dev', 'https://attacker.r2.dev/x'],
  ])('%s never matches %s', (wildcard_host, url) => {
    const policy = { allowed_hosts: [wildcard_host], base_url_host: 'x.invalid' };
    expect(allows(policy, url)).toBe(false);
  });

  it.each([
    ['*.slack.com', 'https://files.slack.com/x'],
    ['*.googleusercontent.com', 'https://lh3.googleusercontent.com/x'],
    ['*.atlassian.net', 'https://team.atlassian.net/x'],
    ['*.sharepoint.com', 'https://team.sharepoint.com/x'],
    ['*.files.example.net', 'https://a.b.files.example.net/x'],
    ['*.amazonaws.com', 'https://console.amazonaws.com/x'],
  ])('%s still matches %s', (wildcard_host, url) => {
    const policy = { allowed_hosts: [wildcard_host], base_url_host: 'x.invalid' };
    expect(allows(policy, url)).toBe(true);
  });
});

describe('is_file_url_allowed: the app base_url host', () => {
  const policy: FileHostPolicy = {
    allowed_hosts: ['*.files.example.net'],
    base_url_host: 'api.example.org',
  };

  it('allows the base_url host that no wildcard matches', () => {
    expect(allows(policy, 'https://api.example.org/files/1')).toBe(true);
  });

  it('allows only that exact host, not its siblings or children', () => {
    expect(allows(policy, 'https://other.example.org/f')).toBe(false);
    expect(allows(policy, 'https://sub.api.example.org/f')).toBe(false);
  });

  it('never reads the base_url host as a wildcard', () => {
    const wildcard_base = { allowed_hosts: [], base_url_host: '*.example.org' };
    expect(allows(wildcard_base, 'https://x.example.org/f')).toBe(false);
  });
});

describe('is_file_url_allowed: scheme and port', () => {
  it('allows only https unless the entry names http', () => {
    expect(allows(slack_policy, 'http://files.slack.com/f')).toBe(false);
    expect(allows(slack_policy, 'ftp://files.slack.com/f')).toBe(false);
    const http_policy = { allowed_hosts: ['http://files.local.test'], base_url_host: 'x.invalid' };
    expect(allows(http_policy, 'http://files.local.test/f')).toBe(true);
    expect(allows(http_policy, 'https://files.local.test/f')).toBe(false);
  });

  it('allows only the default port unless the entry names one', () => {
    expect(allows(slack_policy, 'https://files.slack.com:8443/f')).toBe(false);
    const port_policy = { allowed_hosts: ['files.slack.com:8443'], base_url_host: 'x.invalid' };
    expect(allows(port_policy, 'https://files.slack.com:8443/f')).toBe(true);
    expect(allows(port_policy, 'https://files.slack.com/f')).toBe(false);
  });

  it('reads an entry that names the default port as the default port', () => {
    const policy = { allowed_hosts: ['files.slack.com:443'], base_url_host: 'x.invalid' };
    expect(allows(policy, 'https://files.slack.com/f')).toBe(true);
  });
});

describe('is_protocol_downgrade', () => {
  it('flags https to http only', () => {
    const https_url = new URL('https://files.slack.com/a');
    const http_url = new URL('http://files.slack.com/b');
    expect(is_protocol_downgrade(https_url, http_url)).toBe(true);
    expect(is_protocol_downgrade(https_url, https_url)).toBe(false);
    expect(is_protocol_downgrade(http_url, https_url)).toBe(false);
    expect(is_protocol_downgrade(http_url, http_url)).toBe(false);
  });
});

describe('the file_fetch hosts schema', () => {
  function violation(host: string) {
    return find_json_schema_violation(sync_file_fetch_schema, { hosts: [host] }, 'file_fetch');
  }

  it.each([
    '*slack.com',
    '*.com',
    '*..',
    '*.',
    '*',
    '*.slack..com',
    'files..slack.com',
    '.com',
  ])('refuses %s at load', (host) => {
    expect(violation(host)).not.toBeNull();
  });

  it.each([
    '*.slack.com',
    'files.slack.com',
    'slack.com',
    '*.files.example.org',
  ])('accepts %s', (host) => {
    expect(violation(host)).toBeNull();
  });

  it.each([
    '*.co.uk',
    '*.github.io',
    '*.vercel.app',
    '*.s3.amazonaws.com',
    '*.0.1',
    '*.168.1.1',
    '*.1.1.1',
    '*.localhost',
    '*.r2.dev',
  ])('refuses the public-suffix or IP-shaped wildcard %s at load', (host) => {
    expect(violation(host)).not.toBeNull();
  });

  it.each([
    '*.slack.com',
    '*.googleusercontent.com',
    '*.atlassian.net',
    '*.amazonaws.com',
  ])('accepts the legitimate wildcard %s at load', (host) => {
    expect(violation(host)).toBeNull();
  });
});
