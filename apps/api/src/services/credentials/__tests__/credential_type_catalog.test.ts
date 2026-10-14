import { list_credential_type_choices } from '@api/services/credentials/credential_type_catalog';
import { describe, expect, it } from 'vitest';

describe('list_credential_type_choices', () => {
  const choices = list_credential_type_choices();

  it('offers every protocol the dialog advertises', () => {
    expect(choices.map((choice) => choice.credential_type_key)).toEqual([
      'bearer',
      'basic',
      'api_key_header',
      'api_key_query',
      'oauth2_client_credentials',
      'oauth2_authorization_code',
      'openid_connect',
    ]);
  });

  it('names the published standard each one comes from', () => {
    const by_key = new Map(choices.map((choice) => [choice.credential_type_key, choice]));
    expect(by_key.get('basic')?.standard).toContain('RFC 7617');
    expect(by_key.get('bearer')?.standard).toContain('RFC 6750');
    expect(by_key.get('oauth2_client_credentials')?.standard).toContain('RFC 6749');
  });

  it('asks the customer for at least one secret per protocol', () => {
    for (const choice of choices) {
      expect(choice.fields.some((field) => field.is_secret)).toBe(true);
    }
  });

  it('says where the value ends up, so the dialog is not a black box', () => {
    const by_key = new Map(choices.map((choice) => [choice.credential_type_key, choice]));
    expect(by_key.get('bearer')?.goes).toContain('Authorization');
    expect(by_key.get('api_key_query')?.goes).toContain('query parameter');
    expect(by_key.get('oauth2_client_credentials')?.goes).toContain('fetched from the provider');
  });

  it('never marks a prefilled specification value as a secret', () => {
    for (const choice of choices) {
      for (const field of choice.fields) {
        if (field.prefilled_value !== null) expect(field.is_secret).toBe(false);
      }
    }
  });

  it('compiles every offered protocol — none is unsupported', () => {
    for (const choice of choices) {
      expect(choice.goes).not.toBe('not supported');
    }
  });
});
