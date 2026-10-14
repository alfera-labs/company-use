import { app_needs_a_connection } from '@shared/catalog_app_kind';
import { describe, expect, it } from 'vitest';

describe('app_needs_a_connection', () => {
  it('is true for an app somebody signs into', () => {
    expect(app_needs_a_connection('oauth2')).toBe(true);
    expect(app_needs_a_connection('api_key')).toBe(true);
  });

  it('is false for a built-in tool, which is a capability rather than a place', () => {
    expect(app_needs_a_connection('none')).toBe(false);
    expect(app_needs_a_connection('internal')).toBe(false);
  });

  it('is false when nothing says', () => {
    expect(app_needs_a_connection(null)).toBe(false);
    expect(app_needs_a_connection(undefined)).toBe(false);
  });
});
