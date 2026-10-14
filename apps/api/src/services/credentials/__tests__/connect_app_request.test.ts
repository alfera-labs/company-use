import {
  generate_custom_header_values,
  generate_delivery_rules,
  normalize_request_host,
} from '@api/services/credentials/connect_app_request';
import { describe, expect, it } from 'vitest';

describe('normalize_request_host', () => {
  it.each([
    ['https://www.AcmeBooking.com/app', 'www.acmebooking.com'],
    ['http://api.example.com:8443/v1?q=1', 'api.example.com'],
    ['  www.acmebooking.com  ', 'www.acmebooking.com'],
    ['user@api.example.com', 'api.example.com'],
  ])('turns %s into %s', (typed, expected) => {
    expect(normalize_request_host(typed)).toBe(expected);
  });
});

describe('generate_delivery_rules', () => {
  it('compiles the chosen credential type into a rule for every host', () => {
    const rules = generate_delivery_rules({
      credential_type_key: 'bearer',
      allowed_hosts: ['www.acmebooking.com', 'api.acmebooking.com'],
    });

    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      when_the_request_goes_to: 'www.acmebooking.com',
      put_it_in_header: 'Authorization',
      written_as: 'Bearer {value}',
    });
  });

  it('points a custom header rule at the name the secret is stored under', () => {
    const custom_headers = [{ name: 'X-Vendor-API-Version', prefix: '', value: '2019-06-10' }];
    const [rule] = generate_delivery_rules({
      custom_headers,
      allowed_hosts: ['www.acmebooking.com'],
    });

    expect(rule?.take_the_value_from).toBe('header_x-vendor-api-version');
    expect(generate_custom_header_values(custom_headers)).toHaveProperty(
      'header_x-vendor-api-version',
      '2019-06-10',
    );
  });

  it('keeps the prefix a custom header was given', () => {
    const [rule] = generate_delivery_rules({
      custom_headers: [{ name: 'Authorization', prefix: 'Token', value: 'k_1' }],
      allowed_hosts: ['api.example.com'],
    });

    expect(rule?.written_as).toBe('Token {value}');
  });

  it('produces no rule for a type that needs a token first', () => {
    expect(
      generate_delivery_rules({
        credential_type_key: 'oauth2_authorization_code',
        allowed_hosts: ['api.example.com'],
      }),
    ).toEqual([]);
  });

  it('ignores a half-filled custom header row', () => {
    expect(
      generate_delivery_rules({
        custom_headers: [{ name: 'X-Thing', prefix: '', value: '   ' }],
        allowed_hosts: ['api.example.com'],
      }),
    ).toEqual([]);
  });
});
