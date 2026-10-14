import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { build_restricted_access_config } from '@coworker/core/db/queries/connection_access';
import { move_connection_allow_lists_to_grants } from '@coworker/core/db/queries/connection_allow_lists';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import { apps, connections } from '@coworker/core/db/schema';
import { resource_grants } from '@coworker/core/db/schema/projects';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const owner = 'user_backfill_owner';
const reader = 'user_backfill_reader';

async function build_workspace_with_a_legacy_allow_list() {
  const db = await create_test_database();
  const { workspace_id } = await bootstrap_default_workspace(db);
  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name: 'gmail_backfill',
    app_key: 'gmail_backfill',
    catalog_scope: 'global',
    app_display_name: 'Gmail',
    app_category: 'productivity',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });

  const owner_only = build_restricted_access_config(owner);
  const legacy_config = {
    ...owner_only,
    access: { allowed_users: [...(owner_only.access?.allowed_users ?? []), { user_id: reader }] },
  };

  const connection_id = 'conn_backfill_target';
  await db.insert(connections).values({
    connection_id,
    workspace_id,
    app_id,
    connection_key: `native:${connection_id}`,
    connection_name: "Mira's Gmail",
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: `native:${app_id}`,
    provider_config_version: 1,
    connection_profile_key: `native:${app_id}:oauth2`,
    connection_profile_version: 1,
    auth_method_key: 'oauth2_authorization_code',
    external_account_id: connection_id,
    authorized_scopes: [],
    health_status: 'healthy',
    connection_config: legacy_config,
    connected_by: owner,
    metadata: {},
    created_by: owner,
    last_updated_by: owner,
  });

  await db.insert(resource_grants).values({
    resource_grant_id: create_id(id_prefixes.resource_grant),
    workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    grantee_type: 'project',
    grantee_id: 'proj_backfill_room',
    grant_level: 'use',
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });

  return { db, workspace_id, connection_id };
}

function read_audience(
  db: Awaited<ReturnType<typeof create_test_database>>,
  input: { workspace_id: string; connection_id: string },
) {
  return list_grants_for_resource(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_id: input.connection_id,
  }).then((rows) =>
    rows
      .map((row) => `${row.grantee_type}:${row.grantee_id}:${row.grant_level}`)
      .sort((left, right) => left.localeCompare(right)),
  );
}

describe('moving a JSONB allow-list into the audience', () => {
  it('reports without writing, then writes one grant per person at the right level', async () => {
    const { db, workspace_id, connection_id } = await build_workspace_with_a_legacy_allow_list();

    const reported = await move_connection_allow_lists_to_grants(db, { write: false });
    expect(reported).toEqual([{ connection_id, connection_name: "Mira's Gmail", grants: 2 }]);
    expect(await read_audience(db, { workspace_id, connection_id })).toEqual([
      'project:proj_backfill_room:use',
    ]);

    await move_connection_allow_lists_to_grants(db, { write: true });
    expect(await read_audience(db, { workspace_id, connection_id })).toEqual([
      'project:proj_backfill_room:use',
      `user:${owner}:manage`,
      `user:${reader}:use`,
    ]);
  });

  it('changes nothing on a second run', async () => {
    const { db, workspace_id, connection_id } = await build_workspace_with_a_legacy_allow_list();
    await move_connection_allow_lists_to_grants(db, { write: true });
    const after_first = await read_audience(db, { workspace_id, connection_id });

    await move_connection_allow_lists_to_grants(db, { write: true });
    expect(await read_audience(db, { workspace_id, connection_id })).toEqual(after_first);
  });
});
