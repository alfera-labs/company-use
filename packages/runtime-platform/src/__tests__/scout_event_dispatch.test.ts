import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { event_jobs, events } from '@coworker/core/db/schema';
import { scout_config_key, scout_job_handler } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn();
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const { run_queue_jobs } = await import('@coworker/jobs');
const { find_event_job_handler } = await import(
  '@runtime-platform/events/event_job_handler_registry'
);
const { prepare_trigger_fire_event } = await import('@runtime-platform/events/trigger_ingress');

describe('scout event dispatch', () => {
  beforeEach(() => {
    start_agent_run.mockReset();
    start_agent_run.mockResolvedValue({
      run_id: 'run_dispatch_scout',
      run_status: 'completed',
    });
  });

  it('dispatches a scheduled scout into one hidden normal agent run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Agent scout',
      trigger_type: 'schedule',
      schedule_expression: '1 8,11,14,17 * * 1-5',
      trigger_config: {
        starts_job_handler: scout_job_handler,
        [scout_config_key]: { version: 1, mode: 'autonomous_agent' },
      },
      actor_id: bootstrap.user_id,
    });
    await db.insert(events).values({
      event_id: 'evt_dispatch_slack_message',
      workspace_id: bootstrap.workspace_id,
      source: 'slack',
      source_event_id: 'Ev_DISPATCH',
      event_type: 'message',
      queue_key: 'slack:T_DISPATCH:C_DISPATCH:1710000000.000100',
      actor_key: 'slack_user:U_DISPATCH',
      event_status: 'ignored',
      metadata: { ignored_reason: 'top_level_mention_required' },
      event_body: {
        team_id: 'T_DISPATCH',
        channel_id: 'C_DISPATCH',
        channel_type: 'channel',
        event_ts: '1710000000.000100',
        user_id: 'U_DISPATCH',
        raw_text: 'Can someone pull the weekly support recap?',
      },
      raw_payload: {},
      created_by: 'test',
      last_updated_by: 'test',
    });

    const prepared = prepare_trigger_fire_event(trigger, { occurrence_key: '2026-07-11T09:00' });
    if (!prepared) throw new Error('Scout trigger did not prepare an event.');

    await enqueue_event_jobs(db, prepared.event);
    await run_queue_jobs(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        queue_key: prepared.queue_key,
        worker_id: 'worker-scout-test',
      },
      find_event_job_handler,
    );

    const [job] = await db
      .select()
      .from(event_jobs)
      .where(eq(event_jobs.queue_key, prepared.queue_key));
    expect(job).toMatchObject({
      job_handler: scout_job_handler,
      job_status: 'done',
      run_id: 'run_dispatch_scout',
      result_data: expect.objectContaining({ decision: 'agent_run_completed' }),
    });
    expect(start_agent_run).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        source_type: 'runtime',
        user_message_is_user_visible: false,
        runtime_response_is_user_visible: false,
      }),
      expect.any(Object),
    );
  });
});
