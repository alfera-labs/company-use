import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthorizationUrl: vi.fn(
    (options: { state: string }) =>
      `https://api.workos.com/user_management/authorize?state=${encodeURIComponent(options.state)}`,
  ),
  authenticateWithCode: vi.fn(async () => ({ sealedSession: 'sealed-session' })),
  authenticateWithOrganizationSelection: vi.fn(async () => ({
    sealedSession: 'sealed-session',
  })),
  provision_workos_workspace: vi.fn(async () => ({ organizationId: 'org_resolved' })),
}));

vi.mock('@/lib/workos_workspace_api', () => ({
  provision_workos_workspace: mocks.provision_workos_workspace,
}));

vi.mock('@/lib/workos_session', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/workos_session')>()),
  get_workos: () => ({
    userManagement: {
      getAuthorizationUrl: mocks.getAuthorizationUrl,
      authenticateWithCode: mocks.authenticateWithCode,
      authenticateWithOrganizationSelection: mocks.authenticateWithOrganizationSelection,
    },
  }),
  workos_client_id: () => 'client_test',
  seal_session_option: () => ({ sealSession: true, cookiePassword: 'cookie_password_test' }),
  session_set_cookie: (sealed: string) => `wos-session=${sealed}; Path=/; HttpOnly`,
}));

const {
  complete_direct_oauth,
  is_direct_oauth_callback,
  redirect_to_google_oauth,
  redirect_to_slack_oauth,
} = await import('@/lib/workos_direct_oauth');

beforeEach(() => {
  process.env.WORKOS_CLIENT_ID = 'client_test';
  vi.clearAllMocks();
  mocks.getAuthorizationUrl.mockImplementation(
    (options: { state: string }) =>
      `https://api.workos.com/user_management/authorize?state=${encodeURIComponent(options.state)}`,
  );
  mocks.authenticateWithCode.mockResolvedValue({ sealedSession: 'sealed-session' });
  mocks.authenticateWithOrganizationSelection.mockResolvedValue({
    sealedSession: 'sealed-session',
  });
  mocks.provision_workos_workspace.mockResolvedValue({ organizationId: 'org_resolved' });
});
afterEach(() => {
  delete process.env.WORKOS_CLIENT_ID;
});

describe('redirect_to_google_oauth / redirect_to_slack_oauth', () => {
  it('sends the browser straight to the provider and remembers the state in a cookie', async () => {
    const response = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2Fsettings'),
    );

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'GoogleOAuth',
        clientId: 'client_test',
        redirectUri: 'https://app.example/auth/callback',
      }),
    );
    const state = mocks.getAuthorizationUrl.mock.calls[0]?.[0]?.state ?? '';
    expect(state.startsWith('oauth.')).toBe(true);
    expect(response.headers.get('location')).toContain(encodeURIComponent(state));
    expect(state_cookie_value(response)).toBe(state);
  });

  it('never names an organization in the authorization URL, even with one remembered', async () => {
    await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2F'),
    );

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.not.objectContaining({ organizationId: expect.anything() }),
    );
  });

  it('asks WorkOS for the Slack provider on the slack route', async () => {
    await redirect_to_slack_oauth(
      new Request('https://app.example/auth/sign-in/slack?returnTo=%2F'),
    );

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'SlackOAuth' }),
    );
  });
});

describe('complete_direct_oauth', () => {
  it('signs the session and hands the user to the organization entry route', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2Fsettings'),
    );
    const state = state_cookie_value(started) ?? '';

    const response = await complete_direct_oauth(
      callback_request_for(state, `wos-oauth-state=${state}`),
    );

    expect(mocks.authenticateWithCode).toHaveBeenCalledWith({
      clientId: 'client_test',
      code: 'code_123',
      session: { sealSession: true, cookiePassword: 'cookie_password_test' },
    });
    expect(session_cookie(response)).toBe('wos-session=sealed-session; Path=/; HttpOnly');
    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/organization/refresh?returnTo=%2Fsettings',
    );
  });

  it('expires the state cookie with an appended header so the session survives', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2F'),
    );
    const state = state_cookie_value(started) ?? '';

    const response = await complete_direct_oauth(
      callback_request_for(state, `wos-oauth-state=${state}`),
    );

    const set_cookies = response.headers.getSetCookie();
    expect(set_cookies.some((value) => /^wos-oauth-state=;/.test(value))).toBe(true);
    expect(set_cookies.some((value) => value.includes('Max-Age=0'))).toBe(true);
    expect(session_cookie(response)).toBe('wos-session=sealed-session; Path=/; HttpOnly');
  });

  it('ignores the browser cookie and lets the per-user resolver choose the workspace', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2F'),
    );
    const state = state_cookie_value(started) ?? '';
    mocks.authenticateWithCode.mockRejectedValueOnce(
      Object.assign(new Error('must choose an organization'), {
        code: 'organization_selection_required',
        pendingAuthenticationToken: 'pending_123',
        rawData: { user: { id: 'user_1', email: 'robin@example.com' } },
      }),
    );

    const response = await complete_direct_oauth(
      callback_request_for(state, `wos-oauth-state=${state}`),
    );

    expect(mocks.provision_workos_workspace).toHaveBeenCalled();
    expect(mocks.authenticateWithOrganizationSelection).toHaveBeenCalledWith({
      clientId: 'client_test',
      pendingAuthenticationToken: 'pending_123',
      organizationId: 'org_resolved',
      session: { sealSession: true, cookiePassword: 'cookie_password_test' },
    });
    expect(session_cookie(response)).toBe('wos-session=sealed-session; Path=/; HttpOnly');
    expect(response.headers.get('location')).toContain('/auth/organization/refresh');
  });

  it('resolves the workspace server-side when the browser remembers nothing', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2F'),
    );
    const state = state_cookie_value(started) ?? '';
    mocks.authenticateWithCode.mockRejectedValueOnce(
      Object.assign(new Error('must choose an organization'), {
        code: 'organization_selection_required',
        pendingAuthenticationToken: 'pending_123',
        rawData: { user: { id: 'user_1', email: 'robin@example.com' } },
      }),
    );

    const response = await complete_direct_oauth(
      callback_request_for(state, `wos-oauth-state=${state}`),
    );

    expect(mocks.provision_workos_workspace).toHaveBeenCalledWith({
      user: { id: 'user_1', email: 'robin@example.com', firstName: null, lastName: null },
    });
    expect(mocks.authenticateWithOrganizationSelection).toHaveBeenCalledWith({
      clientId: 'client_test',
      pendingAuthenticationToken: 'pending_123',
      organizationId: 'org_resolved',
      session: { sealSession: true, cookiePassword: 'cookie_password_test' },
    });
    expect(response.headers.get('location')).toContain('/auth/organization/refresh');
  });

  it('hands over to the hosted flow when resolution itself fails', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2F'),
    );
    const state = state_cookie_value(started) ?? '';
    mocks.authenticateWithCode.mockRejectedValueOnce(
      Object.assign(new Error('must choose an organization'), {
        code: 'organization_selection_required',
        pendingAuthenticationToken: 'pending_123',
        rawData: { user: { id: 'user_1' } },
      }),
    );
    mocks.provision_workos_workspace.mockRejectedValueOnce(new Error('api unreachable'));

    const response = await complete_direct_oauth(
      callback_request_for(state, `wos-oauth-state=${state}`),
    );

    expect(session_cookie(response)).toBeUndefined();
    expect(response.headers.get('location')).toContain('/auth/sign-in');
  });

  it('reports the provider error rather than a missing code', async () => {
    const response = await complete_direct_oauth(
      new Request(
        'https://app.example/auth/callback?error=organization_invalid&error_description=No%20Connection&state=oauth.x',
        { headers: { cookie: 'wos-oauth-state=oauth.x' } },
      ),
    );

    expect(session_cookie(response)).toBeUndefined();
    expect(response.headers.get('location')).toContain('/auth/sign-in');
  });

  it('falls back to hosted sign-in when the state cookie does not match', async () => {
    const started = await redirect_to_google_oauth(
      new Request('https://app.example/auth/sign-in/google?returnTo=%2Fsettings'),
    );
    const state = state_cookie_value(started) ?? '';

    const response = await complete_direct_oauth(
      callback_request_for(state, 'wos-oauth-state=oauth.tampered'),
    );

    expect(session_cookie(response)).toBeUndefined();
    expect(response.headers.get('location')).toBe(
      'https://app.example/auth/sign-in?returnTo=%2Fsettings',
    );
  });
});

describe('is_direct_oauth_callback', () => {
  it('claims only callbacks carrying the direct-oauth state prefix', () => {
    expect(is_direct_oauth_callback(callback_request_for('oauth.abc', ''))).toBe(true);
    expect(is_direct_oauth_callback(callback_request_for('hosted-authkit-state', ''))).toBe(false);
    expect(is_direct_oauth_callback(new Request('https://app.example/auth/callback'))).toBe(false);
  });
});

function callback_request_for(state: string, cookie: string) {
  return new Request(
    `https://app.example/auth/callback?code=code_123&state=${encodeURIComponent(state)}`,
    { headers: cookie ? { cookie } : {} },
  );
}

function set_cookie_named(response: Response, name: string) {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}

function session_cookie(response: Response) {
  return set_cookie_named(response, 'wos-session');
}

function state_cookie_value(response: Response) {
  const cookie = set_cookie_named(response, 'wos-oauth-state');
  return cookie?.slice('wos-oauth-state='.length).split(';')[0];
}
