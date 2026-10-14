import { describe, expect, it } from 'vitest';
import { build_resolved_curl_example } from '@/components/credentials/resolved_curl_example';

const masked = '••••••••';

describe('build_resolved_curl_example', () => {
  it('never renders a real value — the mask is structural', () => {
    const example = build_resolved_curl_example({
      allowed_hosts: ['api.example.com'],
      headers: [{ name: 'Authorization', prefix: 'Bearer' }],
    });
    expect(example).toContain(masked);
    expect(example).toContain('Authorization');
    expect(example).toContain('Bearer');
  });

  it('shows one request per allowed website', () => {
    const example = build_resolved_curl_example({
      allowed_hosts: ['api.example.com', 'files.example.com'],
      headers: [{ name: 'X-Api-Key' }],
    });
    expect(example).toContain('curl https://api.example.com/');
    expect(example).toContain('curl https://files.example.com/');
  });

  it('stays valid curl when there are no headers yet', () => {
    expect(build_resolved_curl_example({ allowed_hosts: ['api.example.com'], headers: [] })).toBe(
      'curl https://api.example.com/',
    );
  });

  it('returns nothing before a website is entered', () => {
    expect(build_resolved_curl_example({ allowed_hosts: [], headers: [] })).toBe('');
  });

  it('ignores blank hosts and unnamed header rows', () => {
    const example = build_resolved_curl_example({
      allowed_hosts: ['  ', 'api.example.com'],
      headers: [{ name: '  ', prefix: 'Bearer' }],
    });
    expect(example).toBe('curl https://api.example.com/');
  });
});
