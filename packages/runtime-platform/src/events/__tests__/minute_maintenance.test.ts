import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { event_jobs } from '@coworker/core/db/schema';
import { configure_event_job_doorbell } from '@coworker/jobs';
import { run_minute_maintenance } from '@runtime-platform/events/minute_maintenance';
import { afterEach, beforeEach, expect, it } from 'vitest';

const original_env = {
  EVENT_JOB_DISPATCH_MODE: env.EVENT_JOB_DISPATCH_MODE,
  CONNECTOR_CANARY_APPS: env.CONNECTOR_CANARY_APPS,
};

beforeEach(() => {
  Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet', CONNECTOR_CANARY_APPS: 'gmail' });
  configure_event_job_doorbell({ ring: () => undefined });
});

afterEach(() => {
  Object.assign(env, original_env);
  configure_event_job_doorbell(undefined);
});

it('queues each maintenance job once however many callers tick in the same minute', async () => {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);

  const results = await Promise.all([run_minute_maintenance(db), run_minute_maintenance(db)]);
  await run_minute_maintenance(db);

  expect(Object.keys(results[0])).toEqual(['daily_connector_canary']);
  const queued = await db.select({ job_handler: event_jobs.job_handler }).from(event_jobs);
  expect(queued.map((job) => job.job_handler)).toEqual(['connector_canary']);
});
