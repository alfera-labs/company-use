import { read_api_origin } from '@coworker/config/api_origin';
import { public_env } from '@coworker/config/public_env';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('read_api_origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the server API_URL', () => {
    vi.stubEnv('API_URL', 'https://api.example.com');
    expect(read_api_origin()).toBe('https://api.example.com');
  });

  it('falls back to the public API URL when API_URL is unset', () => {
    vi.stubEnv('API_URL', undefined);
    expect(read_api_origin()).toBe(public_env.NEXT_PUBLIC_API_URL);
  });
});
