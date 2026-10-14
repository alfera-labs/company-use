import { type Database, set_scheduled_task_authority } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session, update_run_status } from '@coworker/core/db/queries/sessions';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { set_user_timezone } from '@coworker/core/db/queries/user_timezone';
import {
  event_jobs,
  events,
  sessions,
  workspace_members,
  workspaces,
} from '@coworker/core/db/schema';
import { projects } from '@coworker/core/db/schema/projects';
import { agent_heartbeat_actor, agent_heartbeat_config_key } from '@coworker/shared';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn(async (_db: Database, _input: StartAgentRunInput) => ({
  run_id: 'run_test',
  run_status: 'completed',
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const { run_scheduled_agent_task_job, system_trigger_idle_skip } = await import(
  '@runtime-platform/events/scheduled_agent_task_job'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;

function first_user_text() {
  const input = start_agent_run.mock.calls[0]?.[1];
  const first_part = input?.user_content?.[0];
  if (!first_part || first_part.type !== 'text') {
    throw new Error('The scheduled task did not start with text content.');
  }
  return first_part.text;
}

async function seed_fired_event(
  db: Db,
  workspace_id: string,
  trigger_id: string,
  instruction?: string,
  context_digest?: string,
  job_input: Record<string, unknown> = {},
) {
  const [event] = await db
    .insert(events)
    .values({
      event_id: 'evt_test',
      workspace_id,
      source: 'trigger',
      source_event_id: `${trigger_id}:2026-06-14T09:00`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${trigger_id}`,
      actor_key: 'system:trigger',
      event_body: {
        trigger_id,
        ...(instruction ? { instruction } : {}),
        ...(context_digest ? { context_digest } : {}),
        ...job_input,
      },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('failed to seed event');
  return event;
}

describe('run_scheduled_agent_task_job', () => {
  beforeEach(() => start_agent_run.mockClear());

  it('launches an agent run with the trigger instruction and returns done', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Daily digest',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * *',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Summarize yesterday.' },
      },
      trigger_source: set_scheduled_task_authority({}, bootstrap.user_id, 'Summarize yesterday.'),
      actor_id: bootstrap.user_id,
    });
    const event = await seed_fired_event(
      db,
      bootstrap.workspace_id,
      trigger.trigger_id,
      'Summarize yesterday.',
      undefined,
      {
        content: [
          { type: 'file', name: 'brief.txt', mime_type: 'text/plain', text: 'Quarterly brief' },
        ],
        model_provider: 'openai',
        model_proxy: 'openai',
        model_name: 'gpt-5.6-luna',
      },
    );

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result.job_status).toBe('done');
    expect(result.run_id).toBe('run_test');
    expect(start_agent_run).toHaveBeenCalledTimes(1);
    expect(start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      workspace_id: bootstrap.workspace_id,
      source_type: 'runtime',
    });
    expect(start_agent_run.mock.calls[0]?.[1]?.user_content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Summarize yesterday.'),
      }),
      { type: 'file', name: 'brief.txt', mime_type: 'text/plain', text: 'Quarterly brief' },
    ]);
    expect(first_user_text()).toContain('This task was authorized when it was scheduled');
    expect(start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      model_provider: 'openai',
      model_proxy: 'openai',
      model_name: 'gpt-5.6-luna',
    });
    expect(start_agent_run.mock.calls[0]?.[1]?.user_message_source_metadata).toMatchObject({
      delegated_authority: {
        kind: 'scheduled_task',
        granted_by_actor_id: bootstrap.user_id,
        trigger_id: trigger.trigger_id,
      },
    });
  });

  it('tells the run the time zone of the task, or else the one of the person who made it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const task_in = async (timezone: string | undefined) => {
      const trigger = await create_trigger(db, {
        workspace_id: bootstrap.workspace_id,
        agent_id: bootstrap.agent_id,
        trigger_name: `Daily note ${timezone ?? 'with no time zone'}`,
        trigger_type: 'schedule',
        schedule_expression: '0 9 * * *',
        trigger_config: {
          starts_job_handler: 'run_scheduled_agent_task',
          ...(timezone ? { timezone } : {}),
        },
        actor_id: bootstrap.user_id,
      });
      start_agent_run.mockClear();
      const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id);
      await run_scheduled_agent_task_job({
        db,
        workspace_id: bootstrap.workspace_id,
        events: [event],
      });
      await db.delete(events).where(eq(events.event_id, event.event_id));
      return start_agent_run.mock.calls[0]?.[1]?.user_message_source_metadata?.local_timezone;
    };

    expect(await task_in('Europe/Rome')).toBe('Europe/Rome');
    expect(await task_in(undefined)).toBeUndefined();
    await set_user_timezone(db, {
      user_id: bootstrap.user_id,
      timezone: 'Asia/Tokyo',
      actor_id: bootstrap.user_id,
    });
    expect(await task_in(undefined)).toBe('Asia/Tokyo');
    expect(await task_in('Europe/Rome')).toBe('Europe/Rome');
  });

  it('gives the fresh run the background from the conversation that scheduled it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const context_digest = 'Jordan asked for this. She wants to approve every draft first.';
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Client update',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * 1',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Send the weekly client update.', context_digest },
      },
      actor_id: bootstrap.user_id,
    });
    const event = await seed_fired_event(
      db,
      bootstrap.workspace_id,
      trigger.trigger_id,
      'Send the weekly client update.',
      context_digest,
    );

    await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(first_user_text()).toBe(
      `Send the weekly client update.\n\nBackground from when this task was scheduled:\n${context_digest}`,
    );
  });

  it('carries scout source protection into the delayed agent run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Scout report',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * *',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Prepare the requested report.' },
      },
      trigger_source: {
        [agent_heartbeat_config_key]: {
          source_event_id: 'evt_slack_request',
          observed_event_ids: ['evt_slack_request'],
        },
      },
      actor_id: agent_heartbeat_actor,
    });
    const event = await seed_fired_event(
      db,
      bootstrap.workspace_id,
      trigger.trigger_id,
      'Prepare the requested report.',
    );

    await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      actor_id: 'system:trigger',
      user_message_source_metadata: {
        trigger_id: trigger.trigger_id,
        [agent_heartbeat_config_key]: {
          source_event_id: 'evt_slack_request',
          observed_event_ids: ['evt_slack_request'],
        },
      },
    });
    expect(start_agent_run.mock.calls[0]?.[1]?.user_message_source_metadata).not.toHaveProperty(
      'delegated_authority',
    );
    expect(first_user_text()).not.toContain('This task was authorized when it was scheduled');
    expect(first_user_text()).toContain(
      'Every slack-send_message-1 or slack-upload_file-1 call must include source_event_id',
    );
  });

  it('returns a completed started run without launching a duplicate scheduled run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Daily digest replay',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * *',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Summarize yesterday.' },
      },
      actor_id: bootstrap.user_id,
    });
    const event = await seed_fired_event(
      db,
      bootstrap.workspace_id,
      trigger.trigger_id,
      'Summarize yesterday.',
    );
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'schedule',
      actor_id: bootstrap.user_id,
    });
    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
    });
    const [event_job] = await db
      .insert(event_jobs)
      .values({
        job_id: 'job_scheduled_completed_replay',
        workspace_id: bootstrap.workspace_id,
        event_id: event.event_id,
        queue_key: event.queue_key,
        job_handler: 'run_scheduled_agent_task',
        job_status: 'running',
        run_id: run.run_id,
        metadata: {},
        created_by: 'test',
        last_updated_by: 'test',
      })
      .returning();
    if (!event_job) throw new Error('failed to seed replay event job');

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      event_jobs: [event_job],
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      run_id: run.run_id,
      result_data: {
        trigger_id: trigger.trigger_id,
        session_id: session.session_id,
        run_id: run.run_id,
        recovered_started_run: true,
      },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('acknowledges without running when the trigger no longer exists', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const event = await seed_fired_event(db, bootstrap.workspace_id, 'trg_gone', 'anything');

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result.job_status).toBe('done');
    expect(result.result_data).toMatchObject({ ran: false, code: 'no_trigger' });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('acknowledges a trigger event without a trigger id instead of launching a run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const [event] = await db
      .insert(events)
      .values({
        event_id: 'evt_missing_trigger_id',
        workspace_id: bootstrap.workspace_id,
        source: 'trigger',
        source_event_id: 'missing-trigger-id:2026-06-14T09:00',
        event_type: 'trigger.fired',
        queue_key: 'trigger:missing',
        actor_key: 'system:trigger',
        event_body: { instruction: 'Anything.' },
        created_by: 'system:trigger',
        last_updated_by: 'system:trigger',
      })
      .returning();
    if (!event) throw new Error('failed to seed event');

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'scheduled_task_skipped' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });
});

describe('a scheduled task in team mode', () => {
  beforeEach(() => start_agent_run.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  async function fired_task_of_the_first_person(db: Db) {
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Weekly report',
      trigger_type: 'schedule',
      schedule_expression: '0 9 * * 1',
      trigger_config: { timezone: 'UTC' },
      actor_id: bootstrap.user_id,
    });
    const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id, 'Report.');
    return { bootstrap, job: { db, workspace_id: bootstrap.workspace_id, events: [event] } };
  }

  it('does not start when the person who made it is no longer on the team', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    const db = await create_test_database();
    const { bootstrap, job } = await fired_task_of_the_first_person(db);
    await db
      .update(workspace_members)
      .set({ member_status: 'inactive' })
      .where(eq(workspace_members.user_id, bootstrap.user_id));

    const result = await run_scheduled_agent_task_job(job);

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'task_of_a_person_who_left' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('starts in the own room of the person who made it while that person is on the team', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    const db = await create_test_database();
    const { bootstrap, job } = await fired_task_of_the_first_person(db);

    await run_scheduled_agent_task_job(job);

    const chat_id = start_agent_run.mock.calls[0]?.[1].session_id ?? '';
    const [chat] = await db.select().from(sessions).where(eq(sessions.session_id, chat_id));
    const [room] = await db
      .select()
      .from(projects)
      .where(eq(projects.project_id, chat?.project_id ?? ''));
    expect(room?.personal_for_user_id).toBe(bootstrap.user_id);
  });

  it('starts in no room, and asks nothing about its maker, outside team mode', async () => {
    const db = await create_test_database();
    const { bootstrap, job } = await fired_task_of_the_first_person(db);
    await db
      .update(workspace_members)
      .set({ member_status: 'inactive' })
      .where(eq(workspace_members.user_id, bootstrap.user_id));

    await run_scheduled_agent_task_job(job);

    const chat_id = start_agent_run.mock.calls[0]?.[1].session_id ?? '';
    const [chat] = await db.select().from(sessions).where(eq(sessions.session_id, chat_id));
    expect(chat?.project_id).toBeNull();
  });
});

describe('system-trigger idle decay', () => {
  beforeEach(() => start_agent_run.mockClear());

  type Bootstrap = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

  function trigger_input(bootstrap: Bootstrap, trigger_source: Record<string, unknown>) {
    return {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'Agent scout',
      trigger_type: 'schedule' as const,
      schedule_expression: '0 9 * * *',
      trigger_config: {
        starts_job_handler: 'run_scheduled_agent_task',
        job_input: { instruction: 'Scout for useful work.' },
      },
      trigger_source,
      actor_id: bootstrap.user_id,
    };
  }

  async function backdate_workspace(db: Db, workspace_id: string, days: number) {
    await db
      .update(workspaces)
      .set({ created_time: new Date(Date.now() - days * 86_400_000) })
      .where(eq(workspaces.workspace_id, workspace_id));
  }

  it('a dormant workspace skips the scout and launches nothing', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await backdate_workspace(db, bootstrap.workspace_id, 35);
    const trigger = await create_trigger(
      db,
      trigger_input(bootstrap, { kind: 'system', source: 'scout_provisioning' }),
    );
    const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id);

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'system_trigger_idle_skipped' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('a user schedule on the same dormant workspace still runs', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await backdate_workspace(db, bootstrap.workspace_id, 35);
    const trigger = await create_trigger(db, trigger_input(bootstrap, { origin: 'agent_tool' }));
    const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id);

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result.job_status).toBe('done');
    expect(start_agent_run).toHaveBeenCalledTimes(1);
  });

  it('an active workspace runs its scout normally, on the cheap scout model', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(
      db,
      trigger_input(bootstrap, { kind: 'system', source: 'scout_provisioning' }),
    );
    const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id);

    const result = await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(result.job_status).toBe('done');
    expect(start_agent_run).toHaveBeenCalledTimes(1);
    expect(start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      model_proxy: 'anthropic',
      model_name: 'claude-haiku-4.5',
    });
  });

  it('a user schedule keeps the workspace model, never the scout model', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const trigger = await create_trigger(db, trigger_input(bootstrap, { origin: 'agent_tool' }));
    const event = await seed_fired_event(db, bootstrap.workspace_id, trigger.trigger_id);

    await run_scheduled_agent_task_job({
      db,
      workspace_id: bootstrap.workspace_id,
      events: [event],
    });

    expect(start_agent_run.mock.calls[0]?.[1]?.model_name).toBeUndefined();
  });

  it('the weekly backoff window runs on Mondays and skips other days', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await backdate_workspace(db, bootstrap.workspace_id, 365);
    await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_source: 'slack',
      actor_id: bootstrap.user_id,
    });
    const monday = new Date('2026-08-31T09:00:00Z');
    const tuesday = new Date('2026-09-01T09:00:00Z');
    await db
      .update(workspaces)
      .set({ created_time: new Date('2020-01-01T00:00:00Z') })
      .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
    const { sessions } = await import('@coworker/core/db/schema');
    await db
      .update(sessions)
      .set({ last_updated_time: new Date('2026-08-21T09:00:00Z') })
      .where(eq(sessions.workspace_id, bootstrap.workspace_id));

    const system_trigger = { trigger_source: { kind: 'system' } };
    expect(
      await system_trigger_idle_skip(db, bootstrap.workspace_id, system_trigger, monday),
    ).toBeNull();
    expect(
      await system_trigger_idle_skip(db, bootstrap.workspace_id, system_trigger, tuesday),
    ).toContain('weekly backoff');
  });
});
