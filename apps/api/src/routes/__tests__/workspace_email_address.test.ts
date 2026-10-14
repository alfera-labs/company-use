import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { workspaces } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

describe('workspace email address routes', () => {
  it('reads null before creation, creates a readable address, and stays idempotent', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const [workspace] = await db.select().from(workspaces);
    if (!workspace || workspace.workspace_id !== bootstrap.workspace_id) {
      throw new Error('bootstrap workspace expected');
    }

    const before = await app.request('/v1/workspace/email-address');
    expect(before.status).toBe(200);
    expect((await before.json()).data.email_address).toBeNull();

    const created = await app.request('/v1/workspace/email-address', { method: 'POST' });
    expect(created.status).toBe(201);
    const created_body = await created.json();
    expect(created_body.data.created).toBe(true);
    expect(created_body.data.email_address).toMatch(
      /^[a-z]+-[a-z]+-\d{2}@inbox\.test\.alfera\.ai$/,
    );
    const local_part = String(created_body.data.email_address).split('@')[0];
    expect(local_part).not.toBe(workspace.workspace_name.toLowerCase());

    const repeated = await app.request('/v1/workspace/email-address', { method: 'POST' });
    expect(repeated.status).toBe(200);
    const repeated_body = await repeated.json();
    expect(repeated_body.data.created).toBe(false);
    expect(repeated_body.data.email_address).toBe(created_body.data.email_address);

    const conflicting = await app.request('/v1/workspace/email-address', {
      method: 'POST',
      body: JSON.stringify({ username: 'something-else' }),
    });
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()).error.code).toBe('email_username_already_set');

    const after = await app.request('/v1/workspace/email-address');
    expect((await after.json()).data.email_address).toBe(created_body.data.email_address);
  });

  it('rejects a username another workspace already owns', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);
    await db.insert(workspaces).values({
      workspace_name: 'Other',
      workspace_slug: 'other-workspace',
      inbound_email_username: 'stolen',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });

    const response = await app.request('/v1/workspace/email-address', {
      method: 'POST',
      body: JSON.stringify({ username: 'stolen' }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('email_username_taken');
  });
});
