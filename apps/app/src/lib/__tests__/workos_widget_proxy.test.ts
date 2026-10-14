import { describe, expect, it } from 'vitest';
import {
  build_workos_widget_response_headers,
  build_workos_widget_upstream_url,
  forward_workos_widget_headers,
} from '@/lib/workos_widget_proxy';

describe('WorkOS widget proxy helpers', () => {
  it('maps same-origin widget requests to the WorkOS widget API', () => {
    expect(
      build_workos_widget_upstream_url(
        'http://localhost:3000/_widgets/UserManagement/members?limit=10',
        ['_widgets', 'UserManagement', 'members'],
      ),
    ).toBe('https://api.workos.com/_widgets/UserManagement/members?limit=10');
  });

  it('rejects path segments that would traverse off the widget prefix', () => {
    expect(() =>
      build_workos_widget_upstream_url('http://localhost:3000/_widgets/..%2Fsso', [
        '_widgets',
        '..',
        'sso',
      ]),
    ).toThrow();
    expect(() =>
      build_workos_widget_upstream_url('http://localhost:3000/_widgets/a%2Fb', ['_widgets', 'a/b']),
    ).toThrow();
  });

  it('only forwards headers the WorkOS widget API needs', () => {
    const headers = forward_workos_widget_headers(
      new Headers({
        Accept: 'application/json',
        Authorization: 'Bearer widget_token',
        Cookie: 'session=secret',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
        'WorkOS-Widgets-Type': 'user-management',
        'X-Elevated-Access-Token': 'elevated_token',
      }),
    );

    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer widget_token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('workos-widgets-type')).toBe('user-management');
    expect(headers.get('x-elevated-access-token')).toBe('elevated_token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('host')).toBeNull();
  });

  it('removes response headers that Next should recalculate', () => {
    const headers = build_workos_widget_response_headers(
      new Headers({
        'Content-Encoding': 'br',
        'Content-Length': '123',
        'Content-Type': 'application/json',
        'Set-Cookie': 'workos=value',
      }),
    );

    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(headers.get('content-encoding')).toBeNull();
    expect(headers.get('content-length')).toBeNull();
    expect(headers.get('set-cookie')).toBeNull();
  });
});
