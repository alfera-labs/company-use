import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { get_app_action_node_key } from '@coworker/core/db/queries/catalog_app_action';
import { apps, nodes } from '@coworker/core/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };

async function insert_action(
  db: Database,
  input: { node_name: string; node_key: string; workspace_id: string | null },
) {
  await db.insert(nodes).values({
    node_id: `node_${input.node_key}`,
    app_id: 'app_mail',
    app_key: 'gmail',
    node_name: input.node_name,
    node_key: input.node_key,
    node_display_name: input.node_name,
    node_kind: 'action',
    catalog_scope: input.workspace_id ? 'workspace' : 'global',
    workspace_id: input.workspace_id,
    input_schema: {},
    runtime_handler: 'composio.action.LIST',
    ...audit,
  });
}

describe('get_app_action_node_key', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await db.insert(apps).values({
      app_id: 'app_mail',
      app_name: 'gmail',
      app_key: 'gmail',
      app_display_name: 'Gmail',
      auth_type: 'oauth',
      ...audit,
    });
    await insert_action(db, {
      node_name: 'list_labels',
      node_key: 'gmail-labels-7',
      workspace_id: null,
    });
    await insert_action(db, {
      node_name: 'list_drafts',
      node_key: 'gmail-drafts-ws_b',
      workspace_id: 'ws_b',
    });
  });

  it('finds a global action from any workspace', async () => {
    const input = { workspace_id: 'ws_a', app_id: 'app_mail', node_name: 'list_labels' };
    expect(await get_app_action_node_key(db, input)).toBe('gmail-labels-7');
  });

  it("never returns another workspace's own action", async () => {
    const input = { app_id: 'app_mail', node_name: 'list_drafts' };
    expect(await get_app_action_node_key(db, { ...input, workspace_id: 'ws_a' })).toBeNull();
    expect(await get_app_action_node_key(db, { ...input, workspace_id: 'ws_b' })).toBe(
      'gmail-drafts-ws_b',
    );
  });
});
