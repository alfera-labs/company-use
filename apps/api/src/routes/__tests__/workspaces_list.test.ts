import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { describe, expect, it } from 'vitest';

const secret = 'local-development-internal-api-secret';
function identity_headers(organization_id: string) {
  return {
    'x-coworker-api-secret': secret,
    'x-coworker-auth-provider': 'workos',
    'x-coworker-auth-user-id': 'user_1',
    'x-coworker-auth-organization-id': organization_id,
    'x-coworker-auth-email': 'a@example.com',
  };
}

describe('GET /v1/workspaces', () => {
  it('returns every workspace the user belongs to, marking the active one', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_1',
      email: 'a@example.com',
      organization_id: 'org_a',
    });
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'user_1',
      email: 'a@example.com',
      organization_id: 'org_b',
    });
    const app = create_app(db);

    const response = await app.request('/v1/workspaces', { headers: identity_headers('org_b') });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { workspaces: Array<{ organization_id: string; is_active: boolean }> };
    };
    const active = body.data.workspaces.find((w) => w.is_active);
    expect(active?.organization_id).toBe('org_b');
    expect(body.data.workspaces).toHaveLength(2);
  });
});
