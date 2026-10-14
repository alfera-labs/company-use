import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const valid_signature = 't=1,v1=the-one-workos-would-have-sent';

vi.mock('@coworker/config', async (import_original) => {
  const original = await import_original<typeof import('@coworker/config')>();
  return {
    ...original,
    env: { ...original.env, WORKOS_WEBHOOK_SECRET: 'whsec_workos_test' },
  };
});

vi.mock('@api/lib/workos_client', () => ({
  resolve_workos_client: () => ({
    webhooks: {
      constructEvent: async (input: { payload: string; sigHeader: string; secret: string }) => {
        if (
          input.sigHeader !== 't=1,v1=the-one-workos-would-have-sent' ||
          input.secret !== 'whsec_workos_test'
        ) {
          throw new Error('Invalid signature');
        }
        return JSON.parse(input.payload);
      },
    },
  }),
}));

const { sync_organization_membership } = vi.hoisted(() => ({
  sync_organization_membership: vi.fn(),
}));

vi.mock('@api/services/workspace', async (import_original) => ({
  ...(await import_original<object>()),
  sync_organization_membership,
}));

const membership_created = {
  event: 'organization_membership.created',
  data: {
    userId: 'user_01',
    organizationId: 'org_01',
    role: { slug: 'admin' },
  },
};

describe('POST /v1/webhooks/workos', () => {
  beforeEach(() => {
    sync_organization_membership.mockClear();
  });

  it('refuses a request with no signature, and syncs nothing', async () => {
    const response = await post(membership_created, {});

    expect(response.status).toBe(400);
    expect(sync_organization_membership).not.toHaveBeenCalled();
  });

  it('refuses a request whose signature does not verify, and syncs nothing', async () => {
    const response = await post(membership_created, { 'workos-signature': 't=1,v1=deadbeef' });

    expect(response.status).toBe(400);
    expect(sync_organization_membership).not.toHaveBeenCalled();
  });

  it('syncs the membership a signed event describes', async () => {
    const response = await post(membership_created, { 'workos-signature': valid_signature });

    expect(response.status).toBe(200);
    expect(sync_organization_membership).toHaveBeenCalledWith(expect.anything(), {
      action: 'upsert',
      provider_user_id: 'user_01',
      organization_id: 'org_01',
      role_slug: 'admin',
    });
  });

  it('deactivates the member a deletion event names', async () => {
    const response = await post(
      { ...membership_created, event: 'organization_membership.deleted' },
      { 'workos-signature': valid_signature },
    );

    expect(response.status).toBe(200);
    expect(sync_organization_membership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'deactivate', provider_user_id: 'user_01' }),
    );
  });

  it('accepts an event it does not act on, without syncing', async () => {
    const response = await post(
      { event: 'organization.deleted', data: { id: 'org_01' } },
      { 'workos-signature': valid_signature },
    );

    expect(response.status).toBe(200);
    expect(sync_organization_membership).not.toHaveBeenCalled();
  });
});

async function post(body: unknown, headers: Record<string, string>) {
  const app = create_app(await create_test_database());
  return app.request('/v1/webhooks/workos', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
