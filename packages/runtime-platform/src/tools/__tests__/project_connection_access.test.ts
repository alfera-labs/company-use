import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { resolve_catalog_tool } from '@coworker/core/db/queries/catalog';
import { build_restricted_access_config } from '@coworker/core/db/queries/connection_access';
import { create_project } from '@coworker/core/db/queries/projects';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import { connections } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it } from 'vitest';

describe('project connection access', () => {
  it('requires both the legacy user list and the project grant', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const slack_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'slack'),
    });
    if (!slack_app) throw new Error('Slack app missing');
    const project = await create_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_name: 'Acme',
      owner_id: bootstrap.user_id,
      actor_id: bootstrap.user_id,
    });
    await db.insert(connections).values({
      connection_id: 'conn_project',
      workspace_id: bootstrap.workspace_id,
      app_id: slack_app.app_id,
      connection_key: 'native:slack:project',
      connection_name: 'Project Slack',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: 'T_PROJECT',
      authorized_scopes: ['channels:read'],
      health_status: 'healthy',
      connection_config: build_restricted_access_config(bootstrap.user_id),
      created_by: 'test',
      last_updated_by: 'test',
    });
    await replace_resource_sharing(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_project',
      shared_with: [
        { grantee_type: 'project', grantee_id: project.project_id, grant_level: 'use' },
      ],
      actor_id: bootstrap.user_id,
    });
    const alice = await upsert_source_actor(db, {
      workspace_id: bootstrap.workspace_id,
      provider: 'dashboard',
      external_id: bootstrap.user_id,
      display_name: 'Alice',
      actor_id: bootstrap.user_id,
    });
    const base = {
      workspace_id: bootstrap.workspace_id,
      node_key: 'slack-read_history-1',
      acting_actor_id: alice.source_actor_id,
    };

    const allowed = await resolve_catalog_tool(db, {
      ...base,
      participants: { project: [project.project_id], user: [], agent: [] },
    });
    const wrong_project = await resolve_catalog_tool(db, {
      ...base,
      participants: { project: ['proj_other'], user: [], agent: [] },
    });
    const missing_participants = await resolve_catalog_tool(db, base);

    expect(allowed.connection?.connection_id).toBe('conn_project');
    expect(wrong_project).toMatchObject({ connection: null, access_denied: true });
    expect(missing_participants).toMatchObject({ connection: null, access_denied: true });
  });

  it('lets the owner reach their own connection in their own room and nowhere else', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const slack_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'slack'),
    });
    if (!slack_app) throw new Error('Slack app missing');

    const marketing = await create_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_name: 'Marketing',
      owner_id: bootstrap.user_id,
      actor_id: bootstrap.user_id,
    });
    const shared_room = await create_project(db, {
      workspace_id: bootstrap.workspace_id,
      project_name: 'Support',
      owner_id: bootstrap.user_id,
      actor_id: bootstrap.user_id,
    });
    const own_room = await db.query.projects.findFirst({
      where: (table, { eq }) => eq(table.personal_for_user_id, bootstrap.user_id),
    });
    if (!own_room) throw new Error('the bootstrapped workspace has no personal room');

    await db.insert(connections).values({
      connection_id: 'conn_owned',
      workspace_id: bootstrap.workspace_id,
      app_id: slack_app.app_id,
      connection_key: 'native:slack:owned',
      connection_name: 'My Slack',
      connection_status: 'active',
      provider_key: 'native',
      provider_config_key: 'native:slack',
      provider_config_version: 1,
      connection_profile_key: 'native:slack:oauth_bot',
      connection_profile_version: 1,
      auth_method_key: 'slack_oauth2_bot',
      external_account_id: 'T_OWNED',
      authorized_scopes: ['channels:read'],
      health_status: 'healthy',
      connection_config: {},
      connected_by: bootstrap.user_id,
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });
    await replace_resource_sharing(db, {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_owned',
      shared_with: [
        { grantee_type: 'project', grantee_id: marketing.project_id, grant_level: 'use' },
      ],
      actor_id: bootstrap.user_id,
    });

    const resolve_in = (project_id: string, room_private_to: string | null) =>
      resolve_catalog_tool(db, {
        workspace_id: bootstrap.workspace_id,
        node_key: 'slack-read_history-1',
        participants: { project: [project_id], user: [bootstrap.user_id], agent: [] },
        room_private_to,
      });

    expect(await resolve_in(shared_room.project_id, null)).toMatchObject({
      connection: null,
      access_denied: true,
    });
    expect(
      (await resolve_in(own_room.project_id, bootstrap.user_id)).connection?.connection_id,
    ).toBe('conn_owned');
    expect((await resolve_in(marketing.project_id, null)).connection?.connection_id).toBe(
      'conn_owned',
    );
  });
});
