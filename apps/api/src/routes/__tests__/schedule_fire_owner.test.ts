import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { fire_due_schedule_triggers } from '@runtime-platform/events/schedule_trigger_loop';
import { like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

const dispatch_mode_in_tests = env.EVENT_JOB_DISPATCH_MODE;

const proxy_secret =
  process.env.COWORKER_API_PROXY_SECRET ?? 'local-development-internal-api-secret';

describe('a schedule tick when the Rivet clock owns schedules', () => {
  afterEach(() => {
    Object.assign(env, { EVENT_JOB_DISPATCH_MODE: dispatch_mode_in_tests });
  });

  it('fires once, even when a leftover external scheduler also calls /v1/events', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Every 4 hours',
      trigger_type: 'schedule',
      schedule_expression: '0 */4 * * *',
      trigger_config: { starts_job_handler: 'daily_digest', timezone: 'UTC' },
      actor_id: bootstrap.user_id,
    });
    await fire_due_schedule_triggers(db, new Date('2026-09-28T19:30:00.000Z'));
    await fire_due_schedule_triggers(db, new Date('2026-09-28T20:00:00.000Z'));
    Object.assign(env, { EVENT_JOB_DISPATCH_MODE: 'rivet' });

    const response = await create_app(db).request(`/v1/events/${trigger.trigger_id}`, {
      method: 'POST',
      headers: { [proxy_auth_headers.secret]: proxy_secret },
    });

    expect((await response.json()).data).toMatchObject({
      fired: false,
      reason: 'schedule_fired_by_clock',
    });
    const fires = await db.query.events.findMany({
      where: like(events.source_event_id, `${trigger.trigger_id}:%`),
    });
    expect(fires.map((fire) => fire.source_event_id)).toEqual([
      `${trigger.trigger_id}:2026-09-28T20:00:00.000Z`,
    ]);
  });
});
