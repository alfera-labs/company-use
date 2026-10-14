import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { restrict_connection_to_one_person } from '@coworker/core/db/queries/connection_people';
import { connections } from '@coworker/core/db/schema';
import { list_connection_snapshot } from '@runtime-platform/connections/connection_snapshot';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { runtime_list_connections_tool } from '@runtime-platform/tools/definitions/runtime_list_connections';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

describe('connection snapshot', () => {
  let db: Awaited<ReturnType<typeof create_test_database>>;
  let workspace_id: string;
  let app_id: string;

  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    await seed_runtime_tool_catalog(db);
    const slack_app = await db.query.apps.findFirst({
      where: (table, { eq }) => eq(table.app_name, 'slack'),
    });
    if (!slack_app) throw new Error('Slack app seed missing');
    app_id = slack_app.app_id;
  });

  function restrict_to(connection_id: string, user_id: string) {
    return restrict_connection_to_one_person(db, { workspace_id, connection_id, user_id });
  }

  it('projects live connection state and applies who is present without exposing account details', async () => {
    await Promise.all([
      insert_connection('shared', {}),
      insert_connection('alice', {}),
      insert_connection('bob', {}),
    ]);
    await restrict_to('conn_alice', 'user_alice');
    await restrict_to('conn_bob', 'user_bob');

    const snapshot = await list_connection_snapshot(db, {
      workspace_id,
      participants: { project: [], agent: [], user: ['user_alice'] },
    });

    expect(snapshot).toHaveLength(3);
    expect(find_connection(snapshot, 'conn_shared')).toMatchObject({
      accessible: true,
      external_account_name: 'Account shared',
    });
    expect(find_connection(snapshot, 'conn_alice')).toMatchObject({
      accessible: true,
      external_account_name: 'Account alice',
    });
    expect(find_connection(snapshot, 'conn_bob')).toMatchObject({
      accessible: false,
      external_account_name: '',
    });
    expect(JSON.stringify(snapshot)).not.toContain('connection_config');
    expect(JSON.stringify(snapshot)).not.toContain('credentials');
  });

  it('marks restricted connections inaccessible when nobody is present', async () => {
    await Promise.all([insert_connection('shared', {}), insert_connection('private', {})]);
    await restrict_to('conn_private', 'user_alice');

    const snapshot = await list_connection_snapshot(db, { workspace_id });

    expect(find_connection(snapshot, 'conn_shared')?.accessible).toBe(true);
    expect(find_connection(snapshot, 'conn_private')?.accessible).toBe(false);
  });

  it('orders healthy active connections before pending and failed connections', async () => {
    await Promise.all([
      insert_connection('failed', {}, 'failed'),
      insert_connection('pending', {}, 'pending_setup'),
      insert_connection('healthy', {}, 'active'),
    ]);

    const snapshot = await list_connection_snapshot(db, { workspace_id });

    expect(snapshot.map((connection) => connection.connection_id)).toEqual([
      'conn_healthy',
      'conn_pending',
      'conn_failed',
    ]);
  });

  it('does not reorder active connections when their health changes', async () => {
    await insert_connection('alpha', {}, 'active', 'healthy');
    await insert_connection('bravo', {}, 'active', 'healthy');
    const while_healthy = await list_connection_snapshot(db, { workspace_id });

    await db
      .update(connections)
      .set({ health_status: 'unhealthy' })
      .where(eq(connections.connection_id, 'conn_alpha'));
    const after_health_flip = await list_connection_snapshot(db, { workspace_id });

    expect(after_health_flip.map((connection) => connection.connection_id)).toEqual(
      while_healthy.map((connection) => connection.connection_id),
    );
    expect(find_connection(after_health_flip, 'conn_alpha')?.health_status).toBe('unhealthy');
  });

  it('keeps the public connection-list tool on the shared snapshot projection', async () => {
    await Promise.all([
      insert_connection('active', {}, 'active'),
      insert_connection('pending', {}, 'pending_setup'),
    ]);

    const result = await runtime_list_connections_tool.execute(
      { include_inactive: false },
      { db, workspace_id, session_id: 'ses_test', run_id: 'run_test', actor_id: 'test' },
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        result_count: 1,
        connections: [{ connection_id: 'conn_active', accessible: true }],
      },
    });
  });

  async function insert_connection(
    suffix: string,
    connection_config: Record<string, unknown>,
    connection_status = 'active',
    health_status = connection_status === 'active' ? 'healthy' : 'unknown',
  ) {
    await db.insert(connections).values({
      connection_id: `conn_${suffix}`,
      workspace_id,
      app_id,
      connection_key: `native:slack:${suffix}`,
      connection_name: `Connection ${suffix}`,
      connection_status,
      external_account_id: `account_${suffix}`,
      external_account_name: `Account ${suffix}`,
      health_status,
      connected_time: new Date('2026-07-18T12:00:00.000Z'),
      connection_config,
      created_by: 'test',
      last_updated_by: 'test',
    });
  }
});

function find_connection(
  snapshot: Awaited<ReturnType<typeof list_connection_snapshot>>,
  connection_id: string,
) {
  return snapshot.find((connection) => connection.connection_id === connection_id);
}
