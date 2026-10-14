import { isRedirect } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let current_request = new Request('https://app.example/home');
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => current_request }));

const { prime_request_auth, read_signed_in_workos_auth, read_workos_auth } = await import(
  '@/lib/workos_session'
);

const ada = { id: 'user_123', email: 'founder@example.com' };

beforeEach(() => {
  current_request = new Request('https://app.example/home');
});

describe('read_workos_auth', () => {
  it('answers signed out for a request the middleware never primed', async () => {
    const auth = await read_workos_auth();

    expect(auth.user).toBeNull();
  });

  it('answers signed out for a request primed with no session', async () => {
    prime_request_auth(current_request, { auth: { user: null } });

    const auth = await read_workos_auth();

    expect(auth.user).toBeNull();
  });

  it('answers with the session the middleware primed', async () => {
    prime_request_auth(current_request, {
      auth: { user: ada as never, organizationId: 'org_123' },
    });

    const auth = await read_workos_auth();

    expect(auth.user).toBe(ada);
    expect(auth.organizationId).toBe('org_123');
  });
});

describe('read_signed_in_workos_auth', () => {
  it('redirects an unprimed request to sign in', async () => {
    const thrown = await read_signed_in_workos_auth().catch((error: unknown) => error);

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/sign-in');
  });

  it('redirects a primed signed-out request to sign in', async () => {
    prime_request_auth(current_request, { auth: { user: null } });

    const thrown = await read_signed_in_workos_auth().catch((error: unknown) => error);

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/sign-in');
  });

  it('returns the session when one is primed', async () => {
    prime_request_auth(current_request, { auth: { user: ada as never } });

    const auth = await read_signed_in_workos_auth();

    expect(auth.user).toBe(ada);
  });
});
