import {
  is_credential_shaped_header_name,
  separate_publishable_headers,
} from '@coworker/core/credentials/credential_shaped_header';
import { describe, expect, it } from 'vitest';

describe('is_credential_shaped_header_name', () => {
  it.each([
    'Authorization',
    'authorization',
    'AUTHORIZATION',
    'Proxy-Authorization',
    'Cookie',
    'Set-Cookie',
    'X-Api-Key',
    'x-api-key',
    'X-Auth-Token',
    'X-Session-Id',
    'X-Client-Secret',
    'X-Access-Token',
    'X-CSRF-Token',
    'Api-Password',
  ])('treats %s as carrying a credential', (header_name) => {
    expect(is_credential_shaped_header_name(header_name)).toBe(true);
  });

  it.each([
    'Accept',
    'Accept-Language',
    'Content-Type',
    'X-Requested-With',
    'X-Vendor-API-Version',
    'X-Client-Version',
    'Accept-Version',
    'User-Agent',
  ])('treats %s as publishable', (header_name) => {
    expect(is_credential_shaped_header_name(header_name)).toBe(false);
  });
});

describe('separate_publishable_headers', () => {
  it('routes each header to exactly one side', () => {
    const { publishable, carries_a_credential } = separate_publishable_headers({
      Accept: 'application/json',
      Authorization: 'Basic c2VjcmV0',
      'X-Vendor-API-Version': '2019-06-10',
    });

    expect(publishable).toEqual({
      Accept: 'application/json',
      'X-Vendor-API-Version': '2019-06-10',
    });
    expect(carries_a_credential).toEqual({ Authorization: 'Basic c2VjcmV0' });
  });

  it('loses nothing — every input header lands on one side', () => {
    const headers = { A: '1', Authorization: '2', 'X-Token': '3', Accept: '4' };
    const { publishable, carries_a_credential } = separate_publishable_headers(headers);

    expect([...Object.keys(publishable), ...Object.keys(carries_a_credential)].sort()).toEqual(
      Object.keys(headers).sort(),
    );
  });

  it('answers with empty halves for no headers', () => {
    expect(separate_publishable_headers({})).toEqual({
      publishable: {},
      carries_a_credential: {},
    });
  });
});
