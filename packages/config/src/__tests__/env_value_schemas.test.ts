import { normalize_origin } from '@coworker/config/env_value_schemas';
import { describe, expect, it } from 'vitest';

describe('normalize_origin', () => {
  it('writes a host in small letters, as a browser sends it', () => {
    expect(normalize_origin('http://Office-Mac.local:3370')).toBe('http://office-mac.local:3370');
  });

  it('drops the dot at the end of a host, the path, and a port the scheme already means', () => {
    expect(normalize_origin('http://Office-Mac.local.:3370/')).toBe('http://office-mac.local:3370');
    expect(normalize_origin(' HTTPS://Alfera.Example.com.:443/connect/callback ')).toBe(
      'https://alfera.example.com',
    );
    expect(normalize_origin('http://alfera.example.com:80')).toBe('http://alfera.example.com');
    expect(normalize_origin('https://alfera.example.com:8443')).toBe(
      'https://alfera.example.com:8443',
    );
  });

  it('leaves an origin that is already written that way as it is', () => {
    for (const origin of [
      'http://localhost:3000',
      'https://app.example.com',
      'http://192.168.1.20:3000',
      'http://[::1]:3000',
    ]) {
      expect(normalize_origin(origin)).toBe(origin);
    }
  });

  it('gives a value that is no address back, trimmed', () => {
    expect(normalize_origin(' * ')).toBe('*');
    expect(normalize_origin('')).toBe('');
  });
});
