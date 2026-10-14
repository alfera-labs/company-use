import { createHash } from 'node:crypto';
import {
  apply_value_encoding,
  find_value_encoding_that_produced,
} from '@coworker/core/credentials/credential_value_encodings';
import { describe, expect, it } from 'vitest';

const value = 'not-a-real-password';
const username = 'test-account@example.invalid';

describe('apply_value_encoding', () => {
  it('rejects an unknown encoding', () => {
    expect(() => apply_value_encoding('unknown', { value })).toThrow(
      'unknown_value_encoding:unknown',
    );
  });

  it('rejects basic authentication without a username', () => {
    expect(() => apply_value_encoding('basic_auth', { value })).toThrow(
      'value_encoding_needs_username:basic_auth',
    );
  });

  it('rejects HMAC SHA-256 without a message', () => {
    expect(() => apply_value_encoding('hmac_sha256', { value })).toThrow(
      'value_encoding_needs_message:hmac_sha256',
    );
  });

  it('returns the value unchanged', () => {
    expect(apply_value_encoding('as_is', { value })).toBe('not-a-real-password');
  });

  it('returns the Base64 value', () => {
    expect(apply_value_encoding('base64', { value })).toBe(Buffer.from(value).toString('base64'));
  });

  it('returns the SHA-256 value', () => {
    expect(apply_value_encoding('sha256', { value })).toBe(
      createHash('sha256').update(value).digest('hex'),
    );
  });

  it('returns the basic authentication value', () => {
    expect(apply_value_encoding('basic_auth', { value, username })).toBe(
      Buffer.from(`${username}:${value}`).toString('base64'),
    );
  });
});

describe('find_value_encoding_that_produced', () => {
  it('identifies an unchanged value', () => {
    expect(find_value_encoding_that_produced(value, `password=${value}`, {})).toEqual({
      encoding: 'as_is',
      rendered: value,
      index: 9,
    });
  });

  it('identifies a URL-encoded value', () => {
    const plaintext = 'Wed 2026!';
    const rendered = 'Wed%202026!';

    expect(find_value_encoding_that_produced(plaintext, `password=${rendered}`, {})).toEqual({
      encoding: 'url_encoded',
      rendered,
      index: 9,
    });
  });

  it('identifies a SHA-256 value', () => {
    const rendered = apply_value_encoding('sha256', { value });

    expect(find_value_encoding_that_produced(value, `password=${rendered}`, {})).toEqual({
      encoding: 'sha256',
      rendered,
      index: 9,
    });
  });

  it('identifies a basic authentication value', () => {
    const rendered = apply_value_encoding('basic_auth', { value, username });

    expect(
      find_value_encoding_that_produced(value, `authorization=${rendered}`, { username }),
    ).toEqual({
      encoding: 'basic_auth',
      rendered,
      index: 14,
    });
  });

  it('returns null when the value is absent', () => {
    expect(find_value_encoding_that_produced(value, 'password=absent', { username })).toBeNull();
  });
});
