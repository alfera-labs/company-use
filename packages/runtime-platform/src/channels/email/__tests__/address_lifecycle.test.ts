import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { workspaces } from '@coworker/core/db/schema';
import { create_workspace_email_address } from '@runtime-platform/channels/email/address_lifecycle';
import { describe, expect, it } from 'vitest';

async function seed_workspace(db: Database, workspace_slug: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: workspace_slug,
      workspace_slug,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  return workspace;
}

describe('create_workspace_email_address', () => {
  it('uses the workspace slug when the name is free', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'acme');

    const address = await create_workspace_email_address(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
    });

    expect(address).toEqual({ email_address: 'acme@inbox.test.alfera.ai', created: true });
  });

  it('suffixes the default name when another workspace chose it first', async () => {
    const db = await create_test_database();
    const squatter = await seed_workspace(db, 'alpha');
    await create_workspace_email_address(db, {
      workspace_id: squatter.workspace_id,
      username: 'support-team',
      actor_id: 'user_1',
    });
    const workspace = await seed_workspace(db, 'support-team');

    const address = await create_workspace_email_address(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
    });

    expect(address.created).toBe(true);
    expect(address.email_address).not.toBe('support-team@inbox.test.alfera.ai');
    expect(address.email_address).toMatch(/^support-team-[0-9a-f]{4}@inbox\.test\.alfera\.ai$/);
  });

  it('reports a clash instead of altering a name the user chose', async () => {
    const db = await create_test_database();
    const first = await seed_workspace(db, 'taken-name');
    await create_workspace_email_address(db, {
      workspace_id: first.workspace_id,
      actor_id: 'user_1',
    });
    const second = await seed_workspace(db, 'second-workspace');

    await expect(
      create_workspace_email_address(db, {
        workspace_id: second.workspace_id,
        username: 'taken-name',
        actor_id: 'user_1',
      }),
    ).rejects.toMatchObject({ code: 'email_username_taken' });
  });

  it('is idempotent for a workspace that already has an address', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'repeat');

    const first = await create_workspace_email_address(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
    });
    const again = await create_workspace_email_address(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
    });

    expect(again).toEqual({ email_address: first.email_address, created: false });
  });
});
