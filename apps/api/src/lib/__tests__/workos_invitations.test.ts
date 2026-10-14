import { list_pending_workspace_invitations } from '@api/lib/workos_invitations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let workos_invitations: unknown[] = [];
let workos_pending_memberships: unknown[] = [];

const workos_double = {
  userManagement: {
    getUser: vi.fn(async () => ({ email: 'Victor@Northwind.com' })),
    listInvitations: vi.fn(async () => ({ data: workos_invitations })),
    listOrganizationMemberships: vi.fn(async () => ({ data: workos_pending_memberships })),
  },
};

vi.mock('@api/lib/workos_client', () => ({
  resolve_workos_client: () => workos_double,
}));

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation_1',
    state: 'pending',
    email: 'victor@northwind.com',
    organizationId: 'org_northwind',
    acceptInvitationUrl: 'https://auth.example.com/invite?invitation_token=tok_1',
    ...overrides,
  };
}

beforeEach(() => {
  workos_invitations = [];
  workos_pending_memberships = [];
  vi.clearAllMocks();
});

describe('pending workspace invitations', () => {
  it('names each invitation from the pending membership WorkOS created alongside it', async () => {
    workos_invitations = [invitation()];
    workos_pending_memberships = [
      { organizationId: 'org_northwind', organizationName: 'Northwind', status: 'pending' },
    ];

    expect(await list_pending_workspace_invitations('user_victor')).toEqual([
      {
        invitation_id: 'invitation_1',
        organization_id: 'org_northwind',
        organization_name: 'Northwind',
        accept_url: 'https://auth.example.com/invite?invitation_token=tok_1',
      },
    ]);
  });

  it('still offers an invitation whose organization name is missing', async () => {
    workos_invitations = [invitation()];

    const invitations = await list_pending_workspace_invitations('user_victor');
    expect(invitations).toHaveLength(1);
    expect(invitations[0]?.organization_name).toBe('A team workspace');
  });

  it('drops invitations that are not pending or carry no organization', async () => {
    workos_invitations = [
      invitation({ id: 'accepted', state: 'accepted' }),
      invitation({ id: 'revoked', state: 'revoked' }),
      invitation({ id: 'expired', state: 'expired' }),
      invitation({ id: 'no_org', organizationId: null }),
      invitation({ id: 'live' }),
    ];

    expect(
      (await list_pending_workspace_invitations('user_victor')).map((one) => one.invitation_id),
    ).toEqual(['live']);
  });

  it('reads the address from WorkOS so the caller cannot choose whose invitations to see', async () => {
    await list_pending_workspace_invitations('user_victor');

    expect(workos_double.userManagement.getUser).toHaveBeenCalledWith('user_victor');
    expect(workos_double.userManagement.listInvitations).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'Victor@Northwind.com' }),
    );
  });
});
