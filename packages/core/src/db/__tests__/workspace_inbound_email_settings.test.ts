import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  read_workspace_inbound_email_settings,
  write_workspace_inbound_email_settings,
} from '@coworker/core/db/queries/workspace_inbound_email_settings';
import { workspaces } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

async function seed_workspace(db: Database) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Acme',
      workspace_slug: 'acme-email-settings',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  return workspace;
}

describe('workspace inbound email settings', () => {
  it('defaults both switches on for a workspace that never wrote them', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    expect(await read_workspace_inbound_email_settings(db, workspace.workspace_id)).toEqual({
      enabled: true,
      attribution_enabled: true,
    });
  });

  it('writes only the provided switch and keeps the other at its stored value', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    await write_workspace_inbound_email_settings(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
      settings: { enabled: false },
    });
    const settings = await write_workspace_inbound_email_settings(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
      settings: { attribution_enabled: false },
    });

    expect(settings).toEqual({ enabled: false, attribution_enabled: false });
  });

  it('preserves sibling workspace_data keys written by other features', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);
    await db
      .update(workspaces)
      .set({
        workspace_data: {
          onboarding: { completed_at: '2026-08-01T00:00:00Z' },
          slack_mirror: { discovery_checkpoints: { general: { last_scanned_ts: '123.456' } } },
        },
      })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    await write_workspace_inbound_email_settings(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
      settings: { enabled: false },
    });

    const [row] = await db
      .select({ workspace_data: workspaces.workspace_data })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    expect(row?.workspace_data.onboarding).toEqual({ completed_at: '2026-08-01T00:00:00Z' });
    expect(row?.workspace_data.slack_mirror).toEqual({
      discovery_checkpoints: { general: { last_scanned_ts: '123.456' } },
    });
    expect(row?.workspace_data.inbound_email).toMatchObject({ enabled: false });
  });

  it('preserves retired_usernames when a switch is written beside them', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);
    await db
      .update(workspaces)
      .set({ workspace_data: { inbound_email: { retired_usernames: ['old-name'] } } })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    await write_workspace_inbound_email_settings(db, {
      workspace_id: workspace.workspace_id,
      actor_id: 'user_1',
      settings: { attribution_enabled: false },
    });

    const [row] = await db
      .select({ workspace_data: workspaces.workspace_data })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    expect(row?.workspace_data.inbound_email).toMatchObject({
      retired_usernames: ['old-name'],
      attribution_enabled: false,
    });
  });

  it('raises not_found for a workspace that does not exist', async () => {
    const db = await create_test_database();

    await expect(
      write_workspace_inbound_email_settings(db, {
        workspace_id: 'ws_missing',
        actor_id: 'user_1',
        settings: { enabled: false },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
