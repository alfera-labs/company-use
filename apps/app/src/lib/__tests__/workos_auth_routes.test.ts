import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthorizationUrl: vi.fn(() => 'https://api.workos.com/user_management/authorize?x=1'),
  authenticateWithCode: vi.fn(async () => ({ sealedSession: 'sealed-session' })),
  generate: vi.fn(async () => ({
    codeVerifier: 'verifier_test',
    codeChallenge: 'challenge_test',
    codeChallengeMethod: 'S256' as const,
  })),
  provision_workos_workspace: vi.fn(async () => ({ organizationId: 'org_resolved' })),
}));

vi.mock('@/lib/workos_session', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/workos_session')>()),
  get_workos: () => ({
    pkce: { generate: mocks.generate },
    userManagement: {
      getAuthorizationUrl: mocks.getAuthorizationUrl,
      authenticateWithCode: mocks.authenticateWithCode,
    },
  }),
  workos_client_id: () => 'client_test',
  seal_session_option: () => ({ sealSession: true, cookiePassword: 'cookie_password_test' }),
  session_set_cookie: (sealed: string) => `wos-session=${sealed}; Path=/; HttpOnly`,
}));

vi.mock('@/lib/workos_workspace_api', () => ({
  provision_workos_workspace: mocks.provision_workos_workspace,
}));

const { redirect_to_workos_sign_in, workos_auth_callback } = await import(
  '@/lib/workos_auth_routes'
);

const hosted_cookie_prefix = 'wos-hosted-auth-';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthorizationUrl.mockReturnValue('https://api.workos.com/user_management/authorize?x=1');
  mocks.authenticateWithCode.mockResolvedValue({ sealedSession: 'sealed-session' });
  mocks.generate.mockResolvedValue({
    codeVerifier: 'verifier_test',
    codeChallenge: 'challenge_test',
    codeChallengeMethod: 'S256',
  });
});

describe('redirect_to_workos_sign_in', () => {
  it('never pins the hosted page to the remembered organization', async () => {
    const response = await redirect_to_workos_sign_in(request_for('/'));

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.not.objectContaining({ organizationId: expect.anything() }),
    );
    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'authkit',
        clientId: 'client_test',
        redirectUri: 'https://app.example/auth/callback',
        screenHint: 'sign-in',
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://api.workos.com/user_management/authorize?x=1',
    );
  });

  it('remembers the PKCE verifier in a cookie named by the state nonce', async () => {
    const response = await redirect_to_workos_sign_in(request_for('/'));

    const nonce = hosted_state_payload().nonce ?? '';
    expect(nonce).toEqual(expect.any(String));
    const cookie = hosted_cookie_line(response) ?? '';
    expect(cookie.startsWith(`${hosted_cookie_prefix}${nonce}=verifier_test;`)).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=600');
  });

  it('keeps the cookie short even when the return path is 2500 characters', async () => {
    const long_path = `/${'a'.repeat(2500)}`;

    const response = await redirect_to_workos_sign_in(request_for(long_path));

    expect(Buffer.byteLength(hosted_cookie_line(response) ?? '')).toBeLessThan(600);
  });

  it('gives two concurrent sign-ins two different cookie names', async () => {
    const first = await redirect_to_workos_sign_in(request_for('/'));
    const second = await redirect_to_workos_sign_in(request_for('/settings'));

    const first_name = cookie_name_of(hosted_cookie_line(first) ?? '');
    const second_name = cookie_name_of(hosted_cookie_line(second) ?? '');
    expect(first_name).not.toBe(second_name);
    expect(first_name.startsWith(hosted_cookie_prefix)).toBe(true);
  });

  it('sends the PKCE challenge to WorkOS and keeps the verifier off the wire', async () => {
    await redirect_to_workos_sign_in(request_for('/'));

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ codeChallenge: 'challenge_test', codeChallengeMethod: 'S256' }),
    );
    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.not.objectContaining({ codeVerifier: expect.anything() }),
    );
  });

  it('returns through the organization entry route, carrying the requested path', async () => {
    await redirect_to_workos_sign_in(request_for('/settings'));

    expect(hosted_state_payload().returnPathname).toBe(
      '/auth/organization/refresh?returnTo=%2Fsettings',
    );
  });

  it('passes the email from the sign-in page form as the hosted login hint', async () => {
    await redirect_to_workos_sign_in(request_with_query('returnTo=%2F&email=robin%40example.com'));

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ loginHint: 'robin@example.com' }),
    );
  });

  it('opens the hosted create-account screen when the page asks for sign-up', async () => {
    await redirect_to_workos_sign_in(request_with_query('returnTo=%2F&screen=sign-up'));

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ screenHint: 'sign-up' }),
    );
  });
});

describe('workos_auth_callback', () => {
  it('hands every callback to the organization entry route and provisions nothing itself', async () => {
    const started = await redirect_to_workos_sign_in(request_for('/'));

    const response = await workos_auth_callback(callback_request_for(started));

    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/organization/refresh?returnTo=%2F',
    );
    expect(mocks.provision_workos_workspace).not.toHaveBeenCalled();
  });

  it('exchanges the code with the verifier, writes the session, and clears the verifier cookie', async () => {
    const started = await redirect_to_workos_sign_in(request_for('/'));
    const nonce = hosted_state_payload().nonce ?? '';

    const response = await workos_auth_callback(callback_request_for(started));

    expect(mocks.authenticateWithCode).toHaveBeenCalledWith({
      clientId: 'client_test',
      code: 'code_123',
      codeVerifier: 'verifier_test',
      session: { sealSession: true, cookiePassword: 'cookie_password_test' },
    });
    expect(response.headers.getSetCookie()).toContainEqual(
      'wos-session=sealed-session; Path=/; HttpOnly',
    );
    expect(cookie_name_of(hosted_cookie_line(response) ?? '')).toBe(
      `${hosted_cookie_prefix}${nonce}`,
    );
    expect(hosted_cookie_line(response)).toContain('Max-Age=0');
  });

  it('returns to the path the sign-in redirect minted into the state', async () => {
    const started = await redirect_to_workos_sign_in(request_for('/settings'));

    const response = await workos_auth_callback(callback_request_for(started));

    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/organization/refresh?returnTo=%2Fsettings',
    );
  });

  it('refuses a callback the browser holds no verifier cookie for', async () => {
    const response = await workos_auth_callback(
      callback_request({ code: 'code_123', state: state_with_nonce('nonce_from_elsewhere') }),
    );

    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://app.example/sign-in');
  });

  it('refuses a callback whose state carries no nonce', async () => {
    const response = await workos_auth_callback(
      callback_request({ code: 'code_123', state: 'state_from_elsewhere' }),
    );

    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://app.example/sign-in');
    expect(hosted_cookie_line(response)).toBeUndefined();
  });

  it('expires only the cookie of the sign-in it refused', async () => {
    const other_tab = await redirect_to_workos_sign_in(request_for('/'));
    const other_nonce = hosted_state_payload().nonce ?? '';

    const response = await workos_auth_callback(
      callback_request(
        { code: 'code_123', state: state_with_nonce('nonce_a') },
        cookie_pair_of(hosted_cookie_line(other_tab) ?? ''),
      ),
    );

    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
    expect(cookie_name_of(hosted_cookie_line(response) ?? '')).toBe(
      `${hosted_cookie_prefix}nonce_a`,
    );
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith(`${hosted_cookie_prefix}${other_nonce}=`)),
    ).toBe(false);
  });

  it('sanitizes a hostile returnTo carried in the state', async () => {
    const state = Buffer.from(
      JSON.stringify({ nonce: 'nonce_a', returnPathname: 'https://evil.example' }),
    ).toString('base64url');

    const response = await workos_auth_callback(
      callback_request({ code: 'code_123', state }, `${hosted_cookie_prefix}nonce_a=verifier_test`),
    );

    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/organization/refresh?returnTo=%2F',
    );
  });

  it('sends the browser back to sign in when the callback carries no code', async () => {
    const response = await workos_auth_callback(callback_request({ error: 'access_denied' }));

    expect(response.headers.get('location')).toBe('https://app.example/sign-in');
    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
  });

  it('sends the browser back to sign in when the code exchange fails', async () => {
    mocks.authenticateWithCode.mockRejectedValueOnce(new Error('invalid code'));
    const started = await redirect_to_workos_sign_in(request_for('/'));

    const response = await workos_auth_callback(callback_request_for(started));

    expect(response.headers.get('location')).toBe('https://app.example/sign-in');
    expect(response.headers.getSetCookie()).not.toContainEqual(
      'wos-session=sealed-session; Path=/; HttpOnly',
    );
  });
});

function request_for(return_to: string) {
  return request_with_query(`returnTo=${encodeURIComponent(return_to)}`);
}

function request_with_query(query: string) {
  return new Request(`https://app.example/auth/sign-in?${query}`, {
    headers: { host: 'app.example', 'x-forwarded-proto': 'https' },
  });
}

function callback_request(params: Record<string, string>, cookie?: string) {
  const url = new URL('https://app.example/auth/callback');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const headers: Record<string, string> = { host: 'app.example', 'x-forwarded-proto': 'https' };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { headers });
}

function callback_request_for(started: Response, overrides: { state?: string } = {}) {
  return callback_request(
    { code: 'code_123', state: overrides.state ?? last_authorization_state() },
    cookie_pair_of(hosted_cookie_line(started) ?? ''),
  );
}

function state_with_nonce(nonce: string) {
  return Buffer.from(JSON.stringify({ nonce, returnPathname: '/' })).toString('base64url');
}

function hosted_cookie_line(response: Response) {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(hosted_cookie_prefix));
}

function cookie_name_of(set_cookie: string) {
  return set_cookie.split('=')[0] ?? '';
}

function cookie_pair_of(set_cookie: string) {
  return set_cookie.split(';')[0] ?? '';
}

function last_authorization_state() {
  const last_call = mocks.getAuthorizationUrl.mock.lastCall as
    | Array<{ state?: string }>
    | undefined;
  return last_call?.[0]?.state ?? '';
}

function hosted_state_payload() {
  return JSON.parse(Buffer.from(last_authorization_state(), 'base64url').toString()) as {
    nonce?: string;
    returnPathname?: string;
  };
}
