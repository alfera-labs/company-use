import { create_app } from '@api/app';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { volumes, workspace_members } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('workspace routes', () => {
  it('returns the resolved workspace for the request', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/workspace', { method: 'GET' });
    const body = await response.json();

    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.workspace_slug, 'default'),
    });
    const members = await db.query.workspace_members.findMany({
      where: (table, { eq }) => eq(table.workspace_id, workspace?.workspace_id ?? ''),
    });

    expect(response.status).toBe(200);
    expect(workspace).toBeTruthy();
    expect(members).toHaveLength(1);
    expect(body.data.viewer_user_id).toBe(members[0]?.user_id);
    expect(body).toMatchObject({
      data: {
        workspace_id: workspace?.workspace_id,
        workspace_name: workspace?.workspace_name,
        workspace_slug: 'default',
      },
    });
    expect(typeof body.data.workspace_name).toBe('string');
    expect(body.data.workspace_name.length).toBeGreaterThan(0);
  });

  it('carries the onboarding gate signals so the shell skips the /v1/onboarding round-trip', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const response = await app.request('/v1/workspace', { method: 'GET' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.onboarding_completed).toBe(false);
    expect(body.data.slack_connected).toBe(false);
  });

  it('preserves a test workspace rename across later requests', async () => {
    const db = await create_test_database();
    const app = create_app(db);

    const rename_response = await app.request('/v1/workspace', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_name: 'QA renamed workspace' }),
    });
    const renamed_body = await rename_response.json();

    const sessions_response = await app.request('/v1/sessions', { method: 'GET' });
    const workspace_response = await app.request('/v1/workspace', { method: 'GET' });
    const workspace_body = await workspace_response.json();

    expect(rename_response.status).toBe(200);
    expect(renamed_body.data.workspace_name).toBe('QA renamed workspace');
    expect(sessions_response.status).toBe(200);
    expect(workspace_response.status).toBe(200);
    expect(workspace_body.data.workspace_name).toBe('QA renamed workspace');
  });

  it('returns persistent-volume health without exposing provider ids or mount credentials', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const volume = await create_volume(db, {
      workspace_id: bootstrap.workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_private_provider_id',
      provider_region: 'aws-us-east-1',
      encrypted_mount_credentials: encrypt_connection_credentials({
        credential_source: 'test',
        values: { mount_token: 'private-mount-token' },
      }),
      actor_id: bootstrap.user_id,
    });
    await db
      .update(volumes)
      .set({
        last_error_code: 'archil_secret_provider_detail',
        last_error_message: 'raw provider trace containing bucket credentials',
      })
      .where(eq(volumes.volume_id, volume.volume_id));
    const app = create_app(db);

    const response = await app.request('/v1/volumes');
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      volume_provider: 'archil',
      volume_status: 'active',
      provider_region: 'aws-us-east-1',
    });
    expect(serialized).not.toContain('dsk_private_provider_id');
    expect(serialized).not.toContain('private-mount-token');
    expect(serialized).not.toContain('encrypted_mount_credentials');
    expect(serialized).not.toContain('raw provider trace');
    expect(body.data.last_error_message).toBe(
      'Persistent workspace storage needs administrator attention.',
    );
  });

  it('rejects persistent-volume provisioning by a non-admin workspace member', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db
      .update(workspace_members)
      .set({
        member_role: 'member',
        last_updated_time: new Date(),
        last_updated_by: bootstrap.user_id,
      })
      .where(
        and(
          eq(workspace_members.workspace_id, bootstrap.workspace_id),
          eq(workspace_members.user_id, bootstrap.user_id),
        ),
      );
    const app = create_app(db);

    const response = await app.request('/v1/volumes', { method: 'POST' });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: {
        code: 'volume_access_denied',
        message: 'Only workspace owners and admins can provision persistent storage.',
      },
    });
  });

  it('returns a clear error when an owner provisions storage while the feature is disabled', async () => {
    const db = await create_test_database();
    const app = create_app(db);
    const original_setting = env.COWORKER_PERSISTENT_WORKSPACES_ENABLED;
    Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: false });

    try {
      const response = await app.request('/v1/volumes', { method: 'POST' });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        error: {
          code: 'persistent_workspaces_disabled',
          message: 'Persistent workspaces are not enabled for this environment.',
        },
      });
    } finally {
      Object.assign(env, { COWORKER_PERSISTENT_WORKSPACES_ENABLED: original_setting });
    }
  });
});
