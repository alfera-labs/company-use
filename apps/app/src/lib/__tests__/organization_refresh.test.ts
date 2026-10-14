import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pin_session_to_provisioned_workspace,
  refresh_organization,
} from '@/lib/organization_refresh';

const mocks = vi.hoisted(() => ({
  read_workos_auth: vi.fn(),
  refresh_session_with_organization: vi.fn(async () => 'wos-session=pinned; Path=/; HttpOnly'),
  provision_workos_workspace: vi.fn(async () => ({ organizationId: 'org_personal' })),
  get_workspace_invitations_to_offer: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/lib/workos_session', () => ({
  read_workos_auth: mocks.read_workos_auth,
  refresh_session_with_organization: mocks.refresh_session_with_organization,
}));
vi.mock('@/lib/workos_workspace_api', () => ({
  provision_workos_workspace: mocks.provision_workos_workspace,
  get_workspace_invitations_to_offer: mocks.get_workspace_invitations_to_offer,
}));

const victor = { id: 'user_victor', email: 'victor@northwind.com' };
const northwind_invitation = {
  invitation_id: 'invitation_1',
  organization_id: 'org_northwind',
  organization_name: 'Northwind',
  accept_url: 'https://auth.example.com/invite?invitation_token=tok_1',
};

function request_for(return_to = '/') {
  return new Request(
    `https://app.example/auth/organization/refresh?returnTo=${encodeURIComponent(return_to)}`,
  );
}

async function redirect_location_of(request: Request) {
  const response = await refresh_organization(request);
  const location = response.headers.get('Location');
  if (response.status !== 307 || !location) {
    throw new Error(`the entry answered ${response.status} instead of redirecting`);
  }
  return location;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provision_workos_workspace.mockResolvedValue({ organizationId: 'org_personal' });
  mocks.get_workspace_invitations_to_offer.mockResolvedValue([]);
  mocks.refresh_session_with_organization.mockResolvedValue('wos-session=pinned; Path=/; HttpOnly');
});

describe('organization entry', () => {
  it('offers a pending team invitation instead of provisioning a workspace', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: victor });
    mocks.get_workspace_invitations_to_offer.mockResolvedValue([northwind_invitation]);

    const location = await redirect_location_of(request_for('/settings'));

    expect(location).toContain('/auth/invitations');
    expect(location).toContain('returnTo=%2Fsettings');
    expect(mocks.provision_workos_workspace).not.toHaveBeenCalled();
  });

  it('provisions, pins, and remembers the organization when nothing is pending', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: victor });

    const response = await refresh_organization(request_for('/home'));

    expect(response.headers.get('Location')).toBe('https://app.example/home');
    expect(mocks.refresh_session_with_organization).toHaveBeenCalledWith('org_personal');
    expect(response.headers.getSetCookie()).toEqual(['wos-session=pinned; Path=/; HttpOnly']);
  });

  it('skips the invitation read and the session refresh for a session that has an organization', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: victor, organizationId: 'org_northwind' });
    mocks.provision_workos_workspace.mockResolvedValue({ organizationId: 'org_northwind' });

    expect(await redirect_location_of(request_for('/'))).toBe('https://app.example/');
    expect(mocks.get_workspace_invitations_to_offer).not.toHaveBeenCalled();
    expect(mocks.refresh_session_with_organization).not.toHaveBeenCalled();
  });

  it('leaves an impersonated session untouched', async () => {
    mocks.read_workos_auth.mockResolvedValue({
      user: victor,
      impersonator: { email: 'admin@example.com' },
    });

    expect(await redirect_location_of(request_for('/'))).toBe('https://app.example/');
    expect(mocks.provision_workos_workspace).not.toHaveBeenCalled();
    expect(mocks.refresh_session_with_organization).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: null });

    const location = await redirect_location_of(request_for('/settings'));

    expect(location).toContain('/auth/sign-in');
    expect(location).toContain('returnTo=%2Fsettings');
  });

  it('answers a page with a retry link when provisioning fails', async () => {
    mocks.read_workos_auth.mockResolvedValue({ user: victor });
    mocks.provision_workos_workspace.mockRejectedValue(new Error('workspace API is down'));
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await refresh_organization(request_for('/home'));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toContain("Your workspace didn't answer");
    expect(body).toContain('href="/auth/organization/refresh?returnTo=%2Fhome"');
    expect(console_error).toHaveBeenCalled();
    console_error.mockRestore();
  });

  it('fails loud when provisioning returns no organization to pin', async () => {
    mocks.provision_workos_workspace.mockResolvedValue({ organizationId: null } as never);

    await expect(
      pin_session_to_provisioned_workspace(
        request_for('/home'),
        { user: victor } as never,
        '/home',
      ),
    ).rejects.toThrow('Organization provisioning did not return an organization to pin');
  });
});
