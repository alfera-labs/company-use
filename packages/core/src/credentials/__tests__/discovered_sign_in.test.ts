import {
  discovered_sign_in_schema,
  validate_discovered_sign_in,
} from '@coworker/core/credentials/discovered_sign_in';
import { describe, expect, it } from 'vitest';

const public_address = async () => ['93.184.216.34'];

function create_discovered(overrides: Record<string, unknown> = {}) {
  return discovered_sign_in_schema.parse({
    app_display_name: 'Acme Planner',
    website_host: 'www.acmebooking.com',
    recipe: {
      visit_first: 'https://www.acmebooking.com/signin',
      post_credentials_to: 'https://www.acmebooking.com/api/account/signin',
      send_fields: { username: 'username', password: 'password' },
      always_send_headers: { 'X-Requested-With': 'XMLHttpRequest' },
      rejected_when_any_field_present: ['SIGNIN_FAIL'],
      read_wait_minutes_from_field: 'PASSWORD_WAIT',
      confirm_by_fetching: 'https://www.acmebooking.com/api/current_login',
      keep_cookies_named: ['session', 'XSRF-TOKEN'],
    },
    ...overrides,
  });
}

const validate = (overrides: Record<string, unknown> = {}) =>
  validate_discovered_sign_in({
    discovered: create_discovered(overrides),
    lookup_addresses: public_address,
  });

describe('validate_discovered_sign_in', () => {
  it('accepts a recipe entirely on the site being connected', async () => {
    expect(await validate()).toEqual({
      accepted: true,
      allowed_hosts: ['www.acmebooking.com'],
    });
  });

  it('keeps the other hosts the app itself calls', async () => {
    expect(await validate({ also_talks_to: ['api.acmebooking.com'] })).toMatchObject({
      accepted: true,
      allowed_hosts: ['www.acmebooking.com', 'api.acmebooking.com'],
    });
  });

  it('refuses a sign-in pointed at a site the app does not own', async () => {
    const verdict = await validate({
      recipe: {
        ...create_discovered().recipe,
        post_credentials_to: 'https://attacker.example/collect',
      },
    });

    expect(verdict).toMatchObject({ accepted: false });
    expect((verdict as { because: string }).because).toContain('not one of the websites');
  });

  it('refuses a confirm address on another site too', async () => {
    expect(
      await validate({
        recipe: {
          ...create_discovered().recipe,
          confirm_by_fetching: 'https://attacker.example/ping',
        },
      }),
    ).toMatchObject({ accepted: false });
  });

  it('refuses an address that resolves inside our own network', async () => {
    expect(
      await validate_discovered_sign_in({
        discovered: create_discovered(),
        lookup_addresses: async () => ['169.254.169.254'],
      }),
    ).toMatchObject({ accepted: false });
  });

  it('refuses http, which would put the password on the wire in clear', async () => {
    expect(
      await validate({
        recipe: {
          ...create_discovered().recipe,
          visit_first: 'http://www.acmebooking.com/signin',
        },
      }),
    ).toMatchObject({ accepted: false });
  });

  it('refuses a sign-in that needs a field the form cannot ask for', async () => {
    const verdict = await validate({
      recipe: {
        ...create_discovered().recipe,
        send_fields: { username: 'username', password: 'password', company: 'company_code' },
      },
    });

    expect(verdict).toMatchObject({ accepted: false });
    expect((verdict as { because: string }).because).toContain('company_code');
  });

  it('refuses a sign-in with no password field at all', async () => {
    expect(
      await validate({
        recipe: { ...create_discovered().recipe, send_fields: { email: 'username' } },
      }),
    ).toMatchObject({ accepted: false });
  });
});

describe('discovered_sign_in_schema', () => {
  it('rejects anything the agent invents beyond the agreed shape', () => {
    expect(() =>
      discovered_sign_in_schema.parse({
        ...create_discovered(),
        deliver_the_password_to: 'https://attacker.example',
      }),
    ).toThrow();
  });

  it('defaults the first box to Email and carries what could not be determined', () => {
    const discovered = create_discovered({ could_not_determine: ['how long the session lasts'] });
    expect(discovered.sign_in_name_label).toBe('Email');
    expect(discovered.could_not_determine).toEqual(['how long the session lasts']);
  });
});
