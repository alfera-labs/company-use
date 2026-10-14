import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { connections, events, runs, sessions } from '@coworker/core/db/schema';
import {
  AppError,
  ConflictError,
  scout_actor,
  scout_config_key,
  scout_job_handler,
  scout_session_kind,
  scout_session_thread_prefix,
} from '@coworker/shared';
import { find_scout_action_error } from '@runtime-platform/tools/policies/scout_action';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn();
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const slack_directory = vi.hoisted(() => ({ members: [] as Array<Record<string, unknown>> }));
vi.mock('@runtime-platform/channels/slack/directory', () => ({
  load_slack_user_directory: async () => ({
    members: slack_directory.members,
    name_by_id: new Map(),
    truncated: false,
    loaded_pages: 1,
  }),
}));

const attention_file = vi.hoisted(() => ({ text: null as string | null }));
vi.mock('@runtime-platform/files/workspace_volume_browser', () => ({
  resolve_workspace_volume_address: async () => ({
    volume_id: 'vol_test',
    provider_volume_id: 'pv_test',
    region: undefined,
    volume_workspace_path: 'agents/agt_test',
    layout: 'workspace_v1',
  }),
  list_workspace_volume_folder: async () => ({ files: [] }),
  read_workspace_volume_file: async () => {
    if (attention_file.text === null) {
      throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
    }
    return new TextEncoder().encode(attention_file.text);
  },
}));

const { run_scout_pulse_job } = await import('@runtime-platform/events/scout_pulse_job');
const { forget_notification_rules_file } = await import(
  '@runtime-platform/notifications/notification_rules_file'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;
type Bootstrap = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

describe('run_scout_pulse_job', () => {
  beforeEach(() => {
    start_agent_run.mockReset();
    start_agent_run.mockResolvedValue({ run_id: 'run_scout', run_status: 'completed' });
    slack_directory.members = [];
    attention_file.text = null;
  });

  it('starts one hidden normal agent run with recent Slack IDs and scout instructions', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    const slack_event = await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    await seed_ignored_bot_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      run_id: 'run_scout',
      result_data: {
        decision: 'agent_run_completed',
        observed_message_count: 1,
        observed_event_ids: [slack_event.event_id],
      },
    });
    expect(start_agent_run).toHaveBeenCalledTimes(1);
    const run_input = start_agent_run.mock.calls[0]?.[1];
    expect(run_input).toMatchObject({
      workspace_id: fixture.bootstrap.workspace_id,
      source_type: 'runtime',
      actor_id: scout_actor,
      user_message_is_user_visible: false,
      runtime_response_is_user_visible: false,
    });
    expect(run_input).not.toHaveProperty('tool_access');
    expect(run_input?.user_message).toContain('slack-read_history-1');
    expect(run_input?.user_message).toContain('notifications-write_notification-1');
    expect(run_input?.user_message).toContain("kind: 'create_automation'");
    expect(run_input?.user_message).toContain('scheduled_tasks-create_scheduled_task-1');
    expect(run_input?.user_message).toContain('You never message anyone');
    expect(run_input?.user_message).toContain('Open loops');
    expect(run_input?.user_message).toContain('Recent signals');
    expect(run_input?.user_message).toContain('reply_thread_ts');
    expect(run_input?.user_message).toContain('never do real work');
    expect(run_input?.user_message).toContain('C_HEARTBEAT');
    expect(run_input?.user_message).toContain('U_REQUESTER');
    expect(run_input?.user_message).toContain('send hello through Gmail');
    const candidates = (run_input?.user_message ?? '').split('Unanswered Slack activity')[1] ?? '';
    expect(candidates).not.toContain('This message came from the bot.');
    expect(run_input?.user_message).toContain('Do not return control JSON');
  });

  it('passes persisted Slack images into the scout run', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_connection(fixture.db, fixture.bootstrap.workspace_id);
    const slack_event = await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    await fixture.db
      .update(events)
      .set({
        raw_payload: {
          team_id: 'T_HEARTBEAT',
          event: {
            files: [
              {
                id: 'F_SCREENSHOT',
                name: 'cache-savings.png',
                mimetype: 'image/png',
                size: 28_208,
              },
            ],
          },
        },
      })
      .where(eq(events.event_id, slack_event.event_id));
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    const run_input = start_agent_run.mock.calls[0]?.[1];
    expect(run_input?.user_content).toContainEqual({
      type: 'file',
      file_id: 'slack:T_HEARTBEAT:F_SCREENSHOT',
      name: 'cache-savings.png',
      mime_type: 'image/png',
    });
    expect(run_input?.attachment_sources).toEqual([
      expect.objectContaining({
        attachment_id: 'slack:T_HEARTBEAT:F_SCREENSHOT',
        file_name: 'cache-savings.png',
        mime_type: 'image/png',
      }),
    ]);
    expect(run_input?.user_message).toContain('runtime-read_attachment-1');
  });

  it('skips without starting a run when there is no recent Slack activity', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'no_open_activity' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('skips a root message when its thread already has a reply', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    await seed_slack_thread_reply(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'no_open_activity' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('blocks a scout action when the thread gets a reply after selection', async () => {
    const fixture = await create_fixture();
    const source = await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    await seed_slack_thread_reply(fixture.db, fixture.bootstrap.workspace_id);

    const result = await find_scout_action_error({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      actor_id: scout_actor,
      source_event_id: source.event_id,
      source_context: {
        source_type: 'runtime',
        source_metadata: { [scout_config_key]: { observed_event_ids: [source.event_id] } },
      },
      action: { action_type: 'create_scheduled_task' },
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'scout_source_answered' },
    });
  });

  it('skips a message addressed to a Slack bot', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_connection(fixture.db, fixture.bootstrap.workspace_id);
    slack_directory.members = [slack_member('U0OTHERBOT', true)];
    await seed_slack_message(
      fixture.db,
      fixture.bootstrap.workspace_id,
      '<@U0OTHERBOT> prepare the weekly report',
    );
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('keeps a message addressed to a human as scout activity', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_connection(fixture.db, fixture.bootstrap.workspace_id);
    slack_directory.members = [slack_member('U0OWNER', false)];
    await seed_slack_message(
      fixture.db,
      fixture.bootstrap.workspace_id,
      '<@U0OWNER> please prepare the weekly report',
    );
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(start_agent_run).toHaveBeenCalledTimes(1);
  });

  it('rethrows a session lock conflict so the job runner retries the pulse', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );
    start_agent_run.mockRejectedValueOnce(new ConflictError('Session is busy.'));

    await expect(
      run_scout_pulse_job({
        db: fixture.db,
        workspace_id: fixture.bootstrap.workspace_id,
        events: [fire],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('reuses one durable session across scout pulses', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );

    await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });
    start_agent_run.mockResolvedValueOnce({ run_id: 'run_scout_2', run_status: 'completed' });
    await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    const first_session_id = start_agent_run.mock.calls[0]?.[1]?.session_id;
    const second_session_id = start_agent_run.mock.calls[1]?.[1]?.session_id;
    expect(first_session_id).toBe(second_session_id);
    const scout_sessions = await fixture.db
      .select()
      .from(sessions)
      .where(
        eq(sessions.external_thread_key, `${scout_session_thread_prefix}:${trigger.trigger_id}`),
      );
    expect(scout_sessions).toHaveLength(1);
    expect(scout_sessions[0]?.source_metadata).toMatchObject({
      kind: scout_session_kind,
      runtime_response_is_user_visible: false,
    });
  });

  it('skips cleanly when the trigger event is missing', async () => {
    const fixture = await create_fixture();

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'scout_skipped' },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('says nothing at all when the dial is off, and says why', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );
    attention_file.text = ['---', 'mode: off', '---', ''].join('\n');

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: {
        ran: false,
        code: 'attention_off',
        message: expect.stringContaining('The dial is off'),
      },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('ends the pulse free when nothing happened since the last look', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );
    const now = new Date('2026-09-15T12:00:00.000Z');
    await seed_scout_run(fixture, trigger.trigger_id, new Date(now.getTime() - 200 * 60 * 1_000));

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
      now,
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: {
        ran: false,
        code: 'nothing_new',
        skipped: 'nothing_new',
        checked: {
          new_signals: 0,
          newly_due_automations: 0,
          new_held_approvals: 0,
          new_questions_asked: 0,
        },
      },
    });
    expect(start_agent_run).not.toHaveBeenCalled();
  });

  it('looks when a signal arrived since the last look', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );
    const now = new Date('2026-09-15T12:00:00.000Z');
    await seed_scout_run(fixture, trigger.trigger_id, new Date(now.getTime() - 200 * 60 * 1_000));

    const result = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
      now,
    });

    expect(result).toMatchObject({ job_status: 'done', result_data: { ran: true } });
    expect(start_agent_run).toHaveBeenCalledTimes(1);
  });

  it('lets eager look twice as often as normal', async () => {
    const fixture = await create_fixture();
    const trigger = await create_scout_trigger(fixture.db, fixture.bootstrap);
    await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);
    const fire = await seed_trigger_fire(
      fixture.db,
      fixture.bootstrap.workspace_id,
      trigger.trigger_id,
    );
    const now = new Date('2026-09-15T12:00:00.000Z');
    await seed_scout_run(fixture, trigger.trigger_id, new Date(now.getTime() - 100 * 60 * 1_000));

    attention_file.text = ['---', 'mode: normal', '---', ''].join('\n');
    forget_notification_rules_file(fixture.bootstrap);
    const under_normal = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
      now,
    });

    attention_file.text = ['---', 'mode: eager', '---', ''].join('\n');
    forget_notification_rules_file(fixture.bootstrap);
    const under_eager = await run_scout_pulse_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [fire],
      now,
    });

    expect(under_normal).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'scout_too_soon' },
    });
    expect(under_eager).toMatchObject({ job_status: 'done', result_data: { ran: true } });
    expect(start_agent_run).toHaveBeenCalledTimes(1);
  });

  it('lands what the scout noticed on the attention ledger instead', async () => {
    const fixture = await create_fixture();
    const { write_notification } = await import(
      '@runtime-platform/notifications/write_notification'
    );

    const result = await write_notification(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      actor_id: scout_actor,
      written_by: 'platform',
      notification: {
        automation_id: null,
        run_id: 'run_scout',
        session_id: 'ses_scout',
        subject: 'invoice_1042',
        claim: 'is unpaid',
        title: 'Invoice 1042 is 41 days late',
        body: 'Nobody has chased it and the automation that would have failed.',
        urgency: 'expires_soon',
        evidence: { event_ids: ['evt_slack_scout_request'] },
        score: 82,
        reason: 'money already owed, and the chase never happened',
      },
    });

    const page = await list_notifications_page(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      page: 1,
      page_size: 100,
    });
    const [row] = page.items;
    expect(result.notification_event_id).not.toBeNull();
    expect(row?.outcome).toBe(result.outcome);
    expect(row?.notification.title).toBe('Invoice 1042 is 41 days late');
  });

  it('refuses to let the scout message anyone, whatever the destination', async () => {
    const fixture = await create_fixture();
    const source = await seed_slack_message(fixture.db, fixture.bootstrap.workspace_id);

    const results = await Promise.all(
      [
        {
          action_type: 'deliver_to_slack' as const,
          channel_id: 'C_HEARTBEAT',
          thread_ts: '1710000000.000100',
        },
        { action_type: 'deliver_to_slack' as const, channel_id: 'U_REQUESTER', thread_ts: null },
      ].map((action) =>
        find_scout_action_error({
          db: fixture.db,
          workspace_id: fixture.bootstrap.workspace_id,
          actor_id: scout_actor,
          source_event_id: source.event_id,
          source_context: {
            source_type: 'runtime',
            source_metadata: { [scout_config_key]: { observed_event_ids: [source.event_id] } },
          },
          action,
        }),
      ),
    );

    for (const result of results) {
      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'scout_cannot_message_people',
          message: expect.stringContaining('notifications-write_notification-1'),
        },
      });
    }
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, bootstrap };
}

function create_scout_trigger(db: Db, bootstrap: Bootstrap) {
  return create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    trigger_name: 'Agent scout',
    trigger_type: 'schedule',
    schedule_expression: '1 8,11,14,17 * * 1-5',
    trigger_config: {
      starts_job_handler: scout_job_handler,
      [scout_config_key]: {
        version: 1,
        mode: 'autonomous_agent',
        max_output_tokens: 1600,
        recent_message_limit: 30,
        max_actions: 3,
      },
    },
    actor_id: bootstrap.user_id,
  });
}

async function seed_scout_run(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  trigger_id: string,
  created_time: Date,
) {
  await fixture.db.insert(runs).values({
    run_id: `run_scout_${created_time.getTime()}`,
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: 'ses_scout',
    agent_id: fixture.bootstrap.agent_id,
    trigger_id,
    run_status: 'completed',
    created_time,
    created_by: scout_actor,
    last_updated_by: scout_actor,
  });
}

async function seed_slack_message(
  db: Db,
  workspace_id: string,
  raw_text = 'Please send hello through Gmail and tell <@U_OWNER> when done.',
) {
  const [event] = await db
    .insert(events)
    .values({
      event_id: 'evt_slack_scout_request',
      workspace_id,
      source: 'slack',
      source_event_id: 'Ev_HEARTBEAT',
      event_type: 'message',
      queue_key: 'slack:T_HEARTBEAT:C_HEARTBEAT:1710000000.000100',
      actor_key: 'slack_user:U_REQUESTER',
      event_status: 'ignored',
      metadata: { ignored_reason: 'top_level_mention_required' },
      event_body: {
        team_id: 'T_HEARTBEAT',
        channel_id: 'C_HEARTBEAT',
        channel_type: 'channel',
        event_ts: '1710000000.000100',
        user_id: 'U_REQUESTER',
        raw_text,
      },
      raw_payload: {},
      created_by: 'test',
      last_updated_by: 'test',
    })
    .returning();
  if (!event) throw new Error('Failed to seed Slack event.');
  return event;
}

async function seed_slack_thread_reply(db: Db, workspace_id: string) {
  await db.insert(events).values({
    event_id: 'evt_slack_scout_reply',
    workspace_id,
    source: 'slack',
    source_event_id: 'Ev_HEARTBEAT_REPLY',
    event_type: 'message',
    queue_key: 'slack:T_HEARTBEAT:C_HEARTBEAT:1710000000.000100',
    actor_key: 'slack_user:U_RESPONDER',
    event_status: 'ignored',
    metadata: { ignored_reason: 'bot_message_ignored' },
    event_body: {
      team_id: 'T_HEARTBEAT',
      channel_id: 'C_HEARTBEAT',
      event_ts: '1710000001.000100',
      thread_ts: '1710000000.000100',
      user_id: 'U_RESPONDER',
      raw_text: 'Already handled.',
    },
    raw_payload: {},
    created_by: 'test',
    last_updated_by: 'test',
  });
}

async function seed_slack_connection(db: Db, workspace_id: string) {
  await db.insert(connections).values({
    connection_id: 'conn_scout_slack',
    workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Scout Slack',
    connection_status: 'active',
    connection_key: 'native:slack:scout-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_HEARTBEAT',
    authorized_scopes: ['channels:history', 'users:read'],
    credentials: { bot_token: 'scout-slack-token' },
    provider_account: { bot_user_id: 'U0LOCALBOT' },
    metadata: {},
    created_by: 'test',
    last_updated_by: 'test',
  });
}

function slack_member(user_id: string, is_bot: boolean) {
  return {
    user_id,
    real_name: null,
    display_name: null,
    email: null,
    timezone: null,
    is_bot,
  };
}

async function seed_ignored_bot_message(db: Db, workspace_id: string) {
  await db.insert(events).values({
    event_id: 'evt_slack_scout_bot',
    workspace_id,
    source: 'slack',
    source_event_id: 'Ev_HEARTBEAT_BOT',
    event_type: 'message',
    queue_key: 'slack:T_HEARTBEAT:ignored:Ev_HEARTBEAT_BOT',
    actor_key: 'slack:T_HEARTBEAT:unknown',
    event_status: 'ignored',
    event_body: {
      team_id: 'T_HEARTBEAT',
      channel_id: 'C_HEARTBEAT',
      event_ts: '1710000001.000100',
      user_id: 'U_BOT',
      raw_text: 'This message came from the bot.',
    },
    raw_payload: {},
    metadata: { ignored_reason: 'bot_message_ignored' },
    created_by: 'test',
    last_updated_by: 'test',
  });
}

async function seed_trigger_fire(db: Db, workspace_id: string, trigger_id: string) {
  const [event] = await db
    .insert(events)
    .values({
      event_id: `evt_fire_${trigger_id}`,
      workspace_id,
      source: 'trigger',
      source_event_id: `${trigger_id}:2026-07-11T09:00`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${trigger_id}`,
      actor_key: 'system:trigger',
      event_body: { trigger_id },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('Failed to seed trigger event.');
  return event;
}
