import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  deactivate_workspace_member,
  list_workspaces_for_user,
  read_last_active_organization,
  set_last_active_organization,
} from '@coworker/core/db/queries/workspace_membership';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { describe, expect, it } from 'vitest';

const base = { provider_key: 'workos', provider_user_id: 'user_1', email: 'a@example.com' };

describe('workspace_membership queries', () => {
  it('lists every active workspace a user belongs to', async () => {
    const db = await create_test_database();
    const first = await provision_workspace_for_identity(db, { ...base, organization_id: 'org_a' });
    await provision_workspace_for_identity(db, { ...base, organization_id: 'org_b' });

    const workspaces = await list_workspaces_for_user(db, first.user_id);

    expect(workspaces.map((w) => w.organization_id).sort()).toEqual(['org_a', 'org_b']);
    expect(workspaces.every((w) => w.workspace_id && w.workspace_name)).toBe(true);
  });

  it('deactivate removes a workspace from the list', async () => {
    const db = await create_test_database();
    const actor = await provision_workspace_for_identity(db, { ...base, organization_id: 'org_a' });
    await provision_workspace_for_identity(db, { ...base, organization_id: 'org_b' });

    await deactivate_workspace_member(db, {
      provider_key: 'workos',
      organization_id: 'org_b',
      provider_user_id: 'user_1',
    });

    const workspaces = await list_workspaces_for_user(db, actor.user_id);
    expect(workspaces.map((w) => w.organization_id)).toEqual(['org_a']);
  });

  it('persists and reads the last active organization on the user row', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, { ...base, organization_id: 'org_a' });

    await set_last_active_organization(db, { ...base, organization_id: 'org_b' });
    const read = await read_last_active_organization(db, base);

    expect(read).toBe('org_b');
  });
});
