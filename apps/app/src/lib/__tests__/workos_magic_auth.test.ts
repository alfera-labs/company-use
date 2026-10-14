import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provision_workos_workspace: vi.fn(async () => ({ organizationId: 'org_resolved' })),
  createMagicAuth: vi.fn(async () => ({})),
  createUser: vi.fn(async () => ({})),
  authenticateWithMagicAuth: vi.fn(async () => ({ sealedSession: 'sealed-session' })),
  authenticateWithOrganizationSelection: vi.fn(async () => ({
    sealedSession: 'sealed-session',
  })),
}));

vi.mock('@/lib/workos_workspace_api', () => ({
  provision_workos_workspace: mocks.provision_workos_workspace,
}));

vi.mock('@/lib/workos_session', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/workos_session')>()),
  get_workos: () => ({
    userManagement: {
      createMagicAuth: mocks.createMagicAuth,
      createUser: mocks.createUser,
      authenticateWithMagicAuth: mocks.authenticateWithMagicAuth,
      authenticateWithOrganizationSelection: mocks.authenticateWithOrganizationSelection,
    },
  }),
  workos_client_id: () => 'client_test',
  seal_session_option: () => ({ sealSession: true, cookiePassword: 'cookie_password_test' }),
  session_set_cookie: (sealed: string) => `wos-session=${sealed}; Path=/; HttpOnly`,
}));

const { send_magic_auth_code, verify_magic_auth_code } = await import('@/lib/workos_magic_auth');

beforeEach(() => {
  process.env.WORKOS_CLIENT_ID = 'client_test';
  vi.clearAllMocks();
  mocks.createMagicAuth.mockResolvedValue({});
  mocks.createUser.mockResolvedValue({});
  mocks.authenticateWithMagicAuth.mockResolvedValue({ sealedSession: 'sealed-session' });
  mocks.authenticateWithOrganizationSelection.mockResolvedValue({
    sealedSession: 'sealed-session',
  });
  mocks.provision_workos_workspace.mockResolvedValue({ organizationId: 'org_resolved' });
});
afterEach(() => {
  delete process.env.WORKOS_CLIENT_ID;
});

describe('send_magic_auth_code', () => {
  it('sends a code for an existing user', async () => {
    const response = await send_magic_auth_code(post('/auth/email/send-code', { email: 'a@b.co' }));

    expect(mocks.createMagicAuth).toHaveBeenCalledWith({ email: 'a@b.co' });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('creates the user first when the email is new', async () => {
    mocks.createMagicAuth
      .mockRejectedValueOnce(new Error('User not found'))
      .mockResolvedValueOnce({});

    const response = await send_magic_auth_code(
      post('/auth/email/send-code', { email: 'new@b.co' }),
    );

    expect(mocks.createUser).toHaveBeenCalledWith({ email: 'new@b.co' });
    expect(mocks.createMagicAuth).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('reports ok:false when WorkOS refuses (e.g. Magic Auth disabled)', async () => {
    mocks.createMagicAuth.mockRejectedValueOnce(new Error('Magic Auth is disabled.'));

    const response = await send_magic_auth_code(post('/auth/email/send-code', { email: 'a@b.co' }));

    expect(await response.json()).toEqual({ ok: false });
  });

  it('rejects a missing or mangled email', async () => {
    const response = await send_magic_auth_code(
      post('/auth/email/send-code', { email: 'not-an-email' }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createMagicAuth).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request before touching WorkOS', async () => {
    const response = await send_magic_auth_code(
      cross_site_post('/auth/email/send-code', { email: 'a@b.co' }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createMagicAuth).not.toHaveBeenCalled();
  });
});

describe('verify_magic_auth_code', () => {
  it('signs the session and returns the organization entry redirect', async () => {
    const response = await verify_magic_auth_code(
      post('/auth/email/verify-code', { email: 'a@b.co', code: '123456', returnTo: '/settings' }),
    );

    expect(mocks.authenticateWithMagicAuth).toHaveBeenCalledWith({
      clientId: 'client_test',
      email: 'a@b.co',
      code: '123456',
      session: { sealSession: true, cookiePassword: 'cookie_password_test' },
    });
    expect(session_cookie(response)).toBe('wos-session=sealed-session; Path=/; HttpOnly');
    expect(await response.json()).toEqual({
      ok: true,
      redirect: '/auth/organization/refresh?returnTo=%2Fsettings',
    });
  });

  it('resolves the workspace server-side when the code belongs to a multi-workspace member', async () => {
    mocks.authenticateWithMagicAuth.mockRejectedValueOnce(
      Object.assign(new Error('must choose an organization'), {
        code: 'organization_selection_required',
        pendingAuthenticationToken: 'pending_123',
        rawData: { user: { id: 'user_1', email: 'a@b.co' } },
      }),
    );

    const response = await verify_magic_auth_code(
      post('/auth/email/verify-code', { email: 'a@b.co', code: '123456', returnTo: '/' }),
    );

    expect(mocks.provision_workos_workspace).toHaveBeenCalled();
    expect(session_cookie(response)).toBe('wos-session=sealed-session; Path=/; HttpOnly');
    expect(await response.json()).toEqual({
      ok: true,
      redirect: '/auth/organization/refresh?returnTo=%2F',
    });
  });

  it('reports ok:false on a wrong code and saves nothing', async () => {
    mocks.authenticateWithMagicAuth.mockRejectedValueOnce(new Error('Invalid code'));

    const response = await verify_magic_auth_code(
      post('/auth/email/verify-code', { email: 'a@b.co', code: '000000', returnTo: '/' }),
    );

    expect(session_cookie(response)).toBeUndefined();
    expect(await response.json()).toEqual({ ok: false });
  });

  it('refuses a cross-site forgery before saving any session', async () => {
    const response = await verify_magic_auth_code(
      cross_site_post('/auth/email/verify-code', {
        email: 'attacker@evil.tld',
        code: '123456',
        returnTo: '/=',
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.authenticateWithMagicAuth).not.toHaveBeenCalled();
    expect(session_cookie(response)).toBeUndefined();
  });

  it('sanitizes a hostile returnTo', async () => {
    const response = await verify_magic_auth_code(
      post('/auth/email/verify-code', {
        email: 'a@b.co',
        code: '123456',
        returnTo: 'https://evil.example',
      }),
    );

    expect(await response.json()).toEqual({
      ok: true,
      redirect: '/auth/organization/refresh?returnTo=%2F',
    });
  });
});

function post(path: string, body: unknown) {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}

function cross_site_post(path: string, body: unknown) {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify(body),
  });
}

function session_cookie(response: Response) {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith('wos-session='));
}
