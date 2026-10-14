import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { find_next_due_work_time } from '@coworker/core/db/queries/due_work_time';
import { brain_sources, event_jobs } from '@coworker/core/db/schema';
import { create_id } from '@coworker/shared';
import { beforeEach, describe, expect, it } from 'vitest';

const workspace_id = 'ws_zq_due_sources';
const actor_id = 'system:test';
const hour_ms = 60 * 60_000;

let db: Database;

beforeEach(async () => {
  db = await create_test_database();
});

async function a_source(input: {
  sync_status: string;
  sync_cadence?: string;
  last_synced_time?: Date;
}) {
  const brain_source_id = create_id('bsrc');
  await db.insert(brain_sources).values({
    brain_source_id,
    workspace_id,
    app_key: 'zq_test_app',
    source_name: 'zq-test source',
    sync_status: input.sync_status,
    ...(input.sync_cadence ? { sync_cadence: input.sync_cadence } : {}),
    last_synced_time: input.last_synced_time ?? null,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  return brain_source_id;
}

async function a_finished_crawl_request(brain_source_id: string, requested_time: Date) {
  await db.insert(event_jobs).values({
    job_id: create_id('ejob'),
    workspace_id,
    queue_key: `brain_source_crawl:${brain_source_id}`,
    job_handler: 'brain_source_crawl',
    job_status: 'done',
    available_time: requested_time,
    created_time: requested_time,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

function due_time() {
  return find_next_due_work_time(db, { stale_wake_ms: 60_000 });
}

describe('the clock wakes for each source on its own sync cadence', () => {
  it('wakes one hour after an hourly source last synced', async () => {
    const synced = new Date(Date.now() - 10 * 60_000);
    await a_source({ sync_status: 'connected', sync_cadence: 'hourly', last_synced_time: synced });

    expect(await due_time()).toEqual(new Date(synced.getTime() + hour_ms));
  });

  it('wakes one day after a daily source last synced', async () => {
    const synced = new Date(Date.now() - 10 * 60_000);
    await a_source({ sync_status: 'connected', sync_cadence: 'daily', last_synced_time: synced });

    expect(await due_time()).toEqual(new Date(synced.getTime() + 24 * hour_ms));
  });

  it('takes the earliest source across workspaces, each by its own cadence', async () => {
    const synced = new Date(Date.now() - 10 * 60_000);
    await a_source({ sync_status: 'connected', sync_cadence: 'weekly', last_synced_time: synced });
    await a_source({ sync_status: 'connected', sync_cadence: 'hourly', last_synced_time: synced });

    expect(await due_time()).toEqual(new Date(synced.getTime() + hour_ms));
  });

  it('never wakes for a manual source or a paused source', async () => {
    const synced = new Date(Date.now() - 2 * hour_ms);
    await a_source({ sync_status: 'connected', sync_cadence: 'manual', last_synced_time: synced });
    await a_source({ sync_status: 'paused', sync_cadence: 'hourly', last_synced_time: synced });

    expect(await due_time()).toBeNull();
  });

  it.each([
    'syncing',
    'never_synced',
  ])('retries a source left %s by a crawl that died an hour after its last request', async (sync_status) => {
    const requested = new Date(Date.now() - 2 * hour_ms);
    const brain_source_id = await a_source({ sync_status, sync_cadence: 'weekly' });
    await a_finished_crawl_request(brain_source_id, requested);

    expect(await due_time()).toEqual(new Date(requested.getTime() + hour_ms));
  });

  it('retries a broken source one day after its last crawl request, not every hour', async () => {
    const requested = new Date(Date.now() - 2 * hour_ms);
    const brain_source_id = await a_source({
      sync_status: 'broken',
      sync_cadence: 'hourly',
      last_synced_time: new Date(Date.now() - 3 * hour_ms),
    });
    await a_finished_crawl_request(brain_source_id, requested);

    expect(await due_time()).toEqual(new Date(requested.getTime() + 24 * hour_ms));
  });

  it('waits an hour after the last crawl request of a source whose sync did not finish', async () => {
    const requested = new Date(Date.now() - 5 * 60_000);
    const brain_source_id = await a_source({
      sync_status: 'connected',
      sync_cadence: 'hourly',
      last_synced_time: new Date(Date.now() - 3 * hour_ms),
    });
    await a_finished_crawl_request(brain_source_id, requested);

    expect(await due_time()).toEqual(new Date(requested.getTime() + hour_ms));
  });
});
