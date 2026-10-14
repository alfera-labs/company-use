import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let workos_client: unknown = null;
let workos_invitations: unknown[] = [];

const workos_double = {
  userManagement: {
    listInvitations: vi.fn(async () => ({ data: workos_invitations })),
    sendInvitation: vi.fn(async (options: { email: string; roleSlug?: string }) => ({
      id: 'invitation_new',
      email: options.email,
      state: 'pending',
      roleSlug: options.roleSlug ?? null,
      createdAt: '2026-09-05T10:00:00.000Z',
    })),
    getInvitation: vi.fn(async (invitation_id: string) => ({
      id: invitation_id,
      organizationId: 'org_team',
    })),
    revokeInvitation: vi.fn(async (invitation_id: string) => ({ id: invitation_id })),
  },
};

vi.mock('@api/lib/workos_client', () => ({
  resolve_workos_client: () => workos_client,
}));

const test_proxy_secret = 'local-development-internal-api-secret';

function provider_headers(input: { user_id: string; organization_id: string; email?: string }) {
  const headers = new Headers([[proxy_auth_headers.secret, test_proxy_secret]]);
  headers.set(proxy_auth_headers.provider_key, 'workos');
  headers.set(proxy_auth_headers.provider_user_id, input.user_id);
  headers.set(proxy_auth_headers.organization_id, input.organization_id);
  headers.set(proxy_auth_headers.email, input.email ?? `${input.user_id}@example.com`);
  return headers;
}

const admin_headers = provider_headers({ user_id: 'user_admin', organization_id: 'org_team' });
const admin_json_headers = new Headers(admin_headers);
admin_json_headers.set('content-type', 'application/json');

const live_invitation = {
  id: 'invitation_1',
  email: 'nina@northwind.com',
  state: 'pending',
  organizationId: 'org_team',
  roleSlug: 'member',
  createdAt: '2026-09-01T10:00:00.000Z',
};

beforeEach(() => {
  workos_client = workos_double;
  workos_invitations = [];
  vi.clearAllMocks();
});

describe('workspace invitation routes', () => {
  it('lists only the live invitations for this organization', async () => {
    workos_invitations = [live_invitation, { ...live_invitation, id: 'gone', state: 'revoked' }];
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/workspace/invitations', { headers: admin_headers });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.invitations).toEqual([
      {
        invitation_id: 'invitation_1',
        email: 'nina@northwind.com',
        role_slug: 'member',
        created_time: '2026-09-01T10:00:00.000Z',
      },
    ]);
    expect(workos_double.userManagement.listInvitations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_team' }),
    );
  });

  it('sends an invitation with the role slug the chosen seat maps to', async () => {
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/workspace/invitations', {
      method: 'POST',
      headers: admin_json_headers,
      body: JSON.stringify({ email: 'nina@northwind.com', role: 'admin' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      invitation_id: 'invitation_new',
      email: 'nina@northwind.com',
    });
    expect(workos_double.userManagement.sendInvitation).toHaveBeenCalledWith({
      email: 'nina@northwind.com',
      organizationId: 'org_team',
      roleSlug: 'admin',
    });
  });

  it('refuses an address that is not an address', async () => {
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/workspace/invitations', {
      method: 'POST',
      headers: admin_json_headers,
      body: JSON.stringify({ email: 'nina at northwind', role: 'member' }),
    });

    expect(response.status).toBe(422);
    expect(workos_double.userManagement.sendInvitation).not.toHaveBeenCalled();
  });

  it('withdraws an invitation this workspace owns', async () => {
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/workspace/invitations/invitation_1', {
      method: 'DELETE',
      headers: admin_headers,
    });

    expect(response.status).toBe(200);
    expect(workos_double.userManagement.revokeInvitation).toHaveBeenCalledWith('invitation_1');
  });

  it('refuses to withdraw an invitation belonging to another organization', async () => {
    workos_double.userManagement.getInvitation.mockResolvedValueOnce({
      id: 'invitation_elsewhere',
      organizationId: 'org_somebody_else',
    });
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/workspace/invitations/invitation_elsewhere', {
      method: 'DELETE',
      headers: admin_headers,
    });

    expect(response.status).toBe(404);
    expect(workos_double.userManagement.revokeInvitation).not.toHaveBeenCalled();
  });

  it.each(['member', 'viewer'])('rejects the %s role on all three routes', async (role) => {
    const db = await create_test_database();
    const app = create_app(db);
    await app.request('/v1/workspace/invitations', { headers: admin_headers });
    await db
      .update(workspace_members)
      .set({ member_role: role })
      .where(eq(workspace_members.member_role, 'owner'));

    const listed = await app.request('/v1/workspace/invitations', { headers: admin_headers });
    const sent = await app.request('/v1/workspace/invitations', {
      method: 'POST',
      headers: admin_json_headers,
      body: JSON.stringify({ email: 'nina@northwind.com', role: 'member' }),
    });
    const revoked = await app.request('/v1/workspace/invitations/invitation_1', {
      method: 'DELETE',
      headers: admin_headers,
    });

    expect([listed.status, sent.status, revoked.status]).toEqual([403, 403, 403]);
    expect(await listed.json()).toMatchObject({
      error: {
        code: 'team_access_denied',
        message: 'Managing the team requires workspace admin access',
      },
    });
  });

  describe('with no WorkOS environment', () => {
    beforeEach(() => {
      workos_client = null;
    });

    it('answers with an empty list', async () => {
      const app = create_app(await create_test_database());

      const response = await app.request('/v1/workspace/invitations', { headers: admin_headers });

      expect(response.status).toBe(200);
      expect((await response.json()).data.invitations).toEqual([]);
    });

    it('explains that sending and withdrawing need WorkOS', async () => {
      const app = create_app(await create_test_database());

      const sent = await app.request('/v1/workspace/invitations', {
        method: 'POST',
        headers: admin_json_headers,
        body: JSON.stringify({ email: 'nina@northwind.com', role: 'member' }),
      });
      const revoked = await app.request('/v1/workspace/invitations/invitation_1', {
        method: 'DELETE',
        headers: admin_headers,
      });

      expect([sent.status, revoked.status]).toEqual([409, 409]);
      expect(await sent.json()).toMatchObject({
        error: {
          code: 'workos_environment_required',
          message: 'Team invitations need a WorkOS environment.',
        },
      });
    });
  });
});
