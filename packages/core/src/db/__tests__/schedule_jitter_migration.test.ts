import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { add_schedule_jitter } from '@coworker/core/services/schedule_jitter';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { describe, expect, it } from 'vitest';

const migrations_directory = resolve(import.meta.dirname, '../migrations');
const jitter_migration = '0064_schedule_jitter.sql';

const scout_cron = '1 8,11,14,17 * * 1-5';
const discovery_cron = '0 9 * * 1';

const paired_workspace_ids = [
  'ws_ana',
  'ws_bo',
  'ws_cleo',
  'ws_carla',
  '01J8ZQ7X0000000000000000',
  'workspace-42',
];

describe('schedule jitter backfill', () => {
  it('computes the same minute in SQL as add_schedule_jitter does in TypeScript', async () => {
    const client = await migrated_database();
    for (const workspace_id of paired_workspace_ids) {
      await insert_trigger(client, {
        trigger_id: `trg_${workspace_id}`,
        workspace_id,
        trigger_name: 'Agent heartbeat',
        starts_job_handler: agent_heartbeat_job_handler,
        schedule_expression: scout_cron,
      });
    }

    await run_migration(client, jitter_migration);

    for (const workspace_id of paired_workspace_ids) {
      expect(await schedule_of(client, `trg_${workspace_id}`)).toBe(
        add_schedule_jitter({
          cron_expression: scout_cron,
          workspace_id,
          window: 'full_hour',
        }),
      );
    }

    await client.close();
  });

  it('moves both system schedules off the minute every workspace shared', async () => {
    const client = await migrated_database();
    await insert_trigger(client, {
      trigger_id: 'trg_beat',
      workspace_id: 'ws_bo',
      trigger_name: 'Agent heartbeat',
      starts_job_handler: agent_heartbeat_job_handler,
      schedule_expression: scout_cron,
    });
    await insert_trigger(client, {
      trigger_id: 'trg_discovery',
      workspace_id: 'ws_bo',
      trigger_name: 'Workspace discovery',
      starts_job_handler: 'run_workspace_discovery',
      schedule_expression: discovery_cron,
    });

    await run_migration(client, jitter_migration);

    expect(await schedule_of(client, 'trg_beat')).toBe('31 8,11,14,17 * * 1-5');
    expect(await schedule_of(client, 'trg_discovery')).toBe('31 9 * * 1');

    await client.close();
  });

  it('leaves user-created schedules alone', async () => {
    const client = await migrated_database();
    await insert_trigger(client, {
      trigger_id: 'trg_user_task',
      workspace_id: 'ws_bo',
      trigger_name: 'Morning digest',
      starts_job_handler: 'run_scheduled_agent_task',
      schedule_expression: '0 9 * * *',
    });
    await insert_trigger(client, {
      trigger_id: 'trg_impostor',
      workspace_id: 'ws_bo',
      trigger_name: 'Agent heartbeat',
      starts_job_handler: 'run_scheduled_agent_task',
      schedule_expression: '0 9 * * *',
    });
    await insert_trigger(client, {
      trigger_id: 'trg_every_four_hours',
      workspace_id: 'ws_bo',
      trigger_name: 'Workspace discovery',
      starts_job_handler: 'run_workspace_discovery',
      schedule_expression: '*/4 * * * *',
    });

    await run_migration(client, jitter_migration);

    expect(await schedule_of(client, 'trg_user_task')).toBe('0 9 * * *');
    expect(await schedule_of(client, 'trg_impostor')).toBe('0 9 * * *');
    expect(await schedule_of(client, 'trg_every_four_hours')).toBe('*/4 * * * *');

    await client.close();
  });

  it('is safe to run twice', async () => {
    const client = await migrated_database();
    await insert_trigger(client, {
      trigger_id: 'trg_beat',
      workspace_id: 'ws_bo',
      trigger_name: 'Agent heartbeat',
      starts_job_handler: agent_heartbeat_job_handler,
      schedule_expression: scout_cron,
    });

    await run_migration(client, jitter_migration);
    const after_first_run = await trigger_row(client, 'trg_beat');
    await run_migration(client, jitter_migration);
    const after_second_run = await trigger_row(client, 'trg_beat');

    expect(after_second_run.schedule_expression).toBe('31 8,11,14,17 * * 1-5');
    expect(after_second_run.last_updated_time).toEqual(after_first_run.last_updated_time);

    await client.close();
  });
});

async function migrated_database() {
  const client = new PGlite({ extensions: { vector } });
  const migration_files = readdirSync(migrations_directory)
    .filter((file_name) => file_name.endsWith('.sql') && file_name < jitter_migration)
    .sort();
  for (const migration_file of migration_files) await run_migration(client, migration_file);
  return client;
}

async function run_migration(client: PGlite, migration_file: string) {
  const migration_sql = readFileSync(resolve(migrations_directory, migration_file), 'utf8');
  for (const statement of migration_sql.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) await client.exec(sql);
  }
}

async function insert_trigger(
  client: PGlite,
  input: {
    trigger_id: string;
    workspace_id: string;
    trigger_name: string;
    starts_job_handler: string;
    schedule_expression: string;
  },
) {
  await client.query(
    `INSERT INTO triggers (
       trigger_id, workspace_id, agent_id, trigger_name, trigger_type, trigger_config,
       schedule_expression, created_by, last_updated_by
     ) VALUES ($1, $2, 'agent_1', $3, 'schedule', jsonb_build_object('starts_job_handler', $4::text),
       $5, 'system:test', 'system:test')`,
    [
      input.trigger_id,
      input.workspace_id,
      input.trigger_name,
      input.starts_job_handler,
      input.schedule_expression,
    ],
  );
}

async function trigger_row(client: PGlite, trigger_id: string) {
  const result = await client.query<{ schedule_expression: string; last_updated_time: Date }>(
    'SELECT schedule_expression, last_updated_time FROM triggers WHERE trigger_id = $1',
    [trigger_id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No trigger ${trigger_id}`);
  return row;
}

async function schedule_of(client: PGlite, trigger_id: string) {
  return (await trigger_row(client, trigger_id)).schedule_expression;
}
