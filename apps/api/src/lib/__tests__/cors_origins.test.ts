import { allowed_cors_origins } from '@api/lib/cors_origins';
import { describe, expect, it } from 'vitest';

describe('allowed_cors_origins', () => {
  it('keeps the configured ALLOWED_ORIGINS list', () => {
    const origins = allowed_cors_origins({
      ALLOWED_ORIGINS: 'http://localhost:3000,http://app.localhost:3000',
      API_URL: 'http://localhost:3101',
    });

    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://app.localhost:3000');
  });

  it('allows an origin that was configured with capitals, as the browser sends it', () => {
    const origins = allowed_cors_origins({
      ALLOWED_ORIGINS: 'http://localhost:3000,http://Office-Mac.local.:3370/',
      API_URL: 'http://localhost:3101',
    });

    expect(origins).toContain('http://office-mac.local:3370');
  });

  it('adds the ngrok tunnel origin when API_PUBLIC_URL is a tunnel URL', () => {
    const origins = allowed_cors_origins({
      ALLOWED_ORIGINS: 'http://app.localhost:3000',
      API_PUBLIC_URL: 'https://abc123.ngrok-free.app',
      API_URL: 'http://localhost:3101',
    });

    expect(origins).toContain('https://abc123.ngrok-free.app');
  });

  it('reduces API_URL to its origin (drops any path) and includes it', () => {
    const origins = allowed_cors_origins({
      ALLOWED_ORIGINS: 'http://app.localhost:3000',
      API_URL: 'https://def456.ngrok-free.app/v1/health',
    });

    expect(origins).toContain('https://def456.ngrok-free.app');
    expect(origins).not.toContain('https://def456.ngrok-free.app/v1/health');
  });

  it('does not duplicate an origin already present in ALLOWED_ORIGINS', () => {
    const origins = allowed_cors_origins({
      ALLOWED_ORIGINS: 'https://abc123.ngrok-free.app,http://app.localhost:3000',
      API_PUBLIC_URL: 'https://abc123.ngrok-free.app',
      API_URL: 'http://localhost:3101',
    });

    const tunnel_count = origins.filter((o) => o === 'https://abc123.ngrok-free.app').length;
    expect(tunnel_count).toBe(1);
  });

  it('ignores an unparseable API_PUBLIC_URL instead of throwing', () => {
    expect(() =>
      allowed_cors_origins({
        ALLOWED_ORIGINS: 'http://app.localhost:3000',
        API_PUBLIC_URL: 'not a url',
        API_URL: 'http://localhost:3101',
      }),
    ).not.toThrow();
  });
});
