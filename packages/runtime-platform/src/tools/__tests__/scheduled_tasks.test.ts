import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import {
  create_tool_call_started,
  update_tool_call_finished,
} from '@coworker/core/db/queries/sessions';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { connections, triggers } from '@coworker/core/db/schema';
import { agent_heartbeat_job_handler } from '@coworker/shared';
import {
  clear_slack_user_directory_cache,
  load_slack_user_directory,
  type SlackMember,
} from '@runtime-platform/channels/slack/directory';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({ conversations_replies: vi.fn() }));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = { replies: slack_sdk.conversations_replies };
  },
}));

const cron_schedule = {
  supports_run_once: true,
  set_schedule: vi.fn(async () => {}),
  pause_schedule: vi.fn(async () => {}),
  delete_schedule: vi.fn(async () => {}),
};

vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => cron_schedule,
}));

const {
  create_scheduled_task_tool,
  delete_scheduled_task_tool,
  edit_scheduled_task_tool,
  list_scheduled_tasks_tool,
  scheduled_task_tools,
} = await import('@runtime-platform/tools/definitions/scheduled_tasks');
const { fire_due_schedule_triggers } = await import(
  '@runtime-platform/events/schedule_trigger_loop'
);

describe('scheduled task runtime tools', () => {
  beforeEach(() => {
    cron_schedule.set_schedule.mockClear();
    cron_schedule.pause_schedule.mockClear();
    cron_schedule.delete_schedule.mockClear();
    slack_sdk.conversations_replies.mockReset();
    clear_slack_user_directory_cache();
  });

  it('reserves scheduling for work the user explicitly asked to run later', () => {
    expect(create_scheduled_task_tool.description).toContain(
      'Only use this tool when the user explicitly asks',
    );
    expect(create_scheduled_task_tool.description).toContain(
      'Never use it to continue, retry, defer, or finish the current request',
    );
  });

  it('creates scheduled tasks through the trigger service contract', async () => {
    const context = await create_runtime_context();
    const fetch_spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected HTTP'));

    try {
      const result = await create_scheduled_task_tool.execute(
        {
          name: 'Weekly report',
          instruction: 'Make me a weekly report.',
          cron_expression: '0 9 * * 1',
          timezone: 'Europe/Rome',
        },
        context,
      );
      const rows = await context.db.query.triggers.findMany();

      expect(result).toMatchObject({
        success: true,
        data: {
          scheduled_task: {
            name: 'Weekly report',
            cron_expression: '0 9 * * 1',
            instruction: 'Make me a weekly report.',
            timezone: 'Europe/Rome',
          },
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspace_id: context.workspace_id,
        agent_id: context.agent_id,
        trigger_name: 'Weekly report',
        trigger_type: 'schedule',
        schedule_expression: '0 9 * * 1',
        trigger_source: {
          origin: 'agent_tool',
          node_key: 'scheduled_tasks-create_scheduled_task-1',
          session_id: context.session_id,
          run_id: context.run_id,
        },
        trigger_config: {
          starts_job_handler: 'run_scheduled_agent_task',
          timezone: 'Europe/Rome',
          job_input: { instruction: 'Make me a weekly report.' },
        },
      });
      expect(cron_schedule.set_schedule).toHaveBeenCalledWith({
        trigger_id: rows[0]?.trigger_id,
        cron_expression: '0 9 * * 1',
        timezone: 'Europe/Rome',
      });
      expect(fetch_spy).not.toHaveBeenCalled();
    } finally {
      fetch_spy.mockRestore();
    }
  });

  it('stores the conversation digest and keeps it when only the instruction is edited', async () => {
    const context = await create_runtime_context();
    const context_digest =
      'Jordan asked for this. Jordan writes to the client in Spanish and wants to approve every draft before it goes out.';

    await create_scheduled_task_tool.execute(
      {
        name: 'Client update',
        instruction: 'Send the weekly client update.',
        context_digest,
        cron_expression: '0 9 * * 1',
        timezone: 'Europe/Rome',
      },
      context,
    );
    const [created] = await context.db.query.triggers.findMany();
    if (!created) throw new Error('the scheduled task was not created');

    const edited = await edit_scheduled_task_tool.execute(
      {
        scheduled_task_id: created.trigger_id,
        instruction: 'Send the weekly client update every Monday morning.',
      },
      context,
    );
    const [after_edit] = await context.db.query.triggers.findMany();

    expect(created.trigger_config).toMatchObject({
      job_input: { instruction: 'Send the weekly client update.', context_digest },
    });
    expect(edited).toMatchObject({
      success: true,
      data: { scheduled_task: { context_digest } },
    });
    expect(after_edit?.trigger_config).toMatchObject({
      job_input: {
        instruction: 'Send the weekly client update every Monday morning.',
        context_digest,
      },
    });
  });

  it('creates a recurring browser workflow without requiring a publication tool call', async () => {
    const context = await create_runtime_context();
    await record_tool_call(context, 'browser', { command: 'click @e5' });

    const result = await create_scheduled_task_tool.execute(
      {
        name: 'Portal sync',
        instruction: 'Use the customer portal client in /work/clients/customer-portal.',
        cron_expression: '*/10 * * * *',
      },
      context,
    );

    expect(result).toMatchObject({ success: true });
    expect(await context.db.query.triggers.findMany()).toHaveLength(1);
  });

  it("defaults the timezone to the workspace's people when the agent omits it", async () => {
    const context = await create_runtime_context();
    await seed_slack_connection(context.db, context.workspace_id);
    await load_slack_user_directory('tz-test-bot-token', Date.now(), async () => ({
      members: [
        member({ user_id: 'U1', timezone: 'Europe/Rome' }),
        member({ user_id: 'U2', timezone: 'Europe/Rome' }),
        member({ user_id: 'U3', timezone: 'America/New_York' }),
        member({ user_id: 'B1', timezone: 'America/Los_Angeles', is_bot: true }),
      ],
      name_by_id: new Map(),
      truncated: false,
      loaded_pages: 1,
    }));

    const result = await create_scheduled_task_tool.execute(
      {
        name: 'Morning digest',
        instruction: 'Post the digest.',
        cron_expression: '0 10 * * 1',
      },
      context,
    );
    const rows = await context.db.query.triggers.findMany();

    expect(result).toMatchObject({
      success: true,
      data: { scheduled_task: { timezone: 'Europe/Rome' } },
    });
    expect(rows[0]?.trigger_config).toMatchObject({ timezone: 'Europe/Rome' });
    expect(cron_schedule.set_schedule).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Rome' }),
    );
  });

  it('falls back to UTC when the workspace has no Slack connection', async () => {
    const context = await create_runtime_context();

    const result = await create_scheduled_task_tool.execute(
      {
        name: 'No Slack task',
        instruction: 'Run anyway.',
        cron_expression: '0 9 * * *',
      },
      context,
    );
    const rows = await context.db.query.triggers.findMany();

    expect(result).toMatchObject({ success: true });
    expect(rows[0]?.trigger_config).toMatchObject({ timezone: 'UTC' });
  });

  it('lists only scheduled agent tasks for the current agent', async () => {
    const context = await create_runtime_context();
    const agent_id = required_agent_id(context);
    await create_agent_task(context, { name: 'Visible task', agent_id });
    await create_agent_task(context, { name: 'Other agent task', agent_id: 'agt_other' });
    await create_trigger(context.db, {
      workspace_id: context.workspace_id,
      agent_id,
      trigger_name: 'Scout',
      trigger_type: 'schedule',
      schedule_expression: '*/15 * * * *',
      trigger_config: { starts_job_handler: agent_heartbeat_job_handler },
      actor_id: context.actor_id,
    });

    const result = await list_scheduled_tasks_tool.execute({ include_completed: false }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        count: 1,
        scheduled_tasks: [{ name: 'Visible task' }],
      },
    });
  });

  it('checks ownership before deleting through the trigger service', async () => {
    const context = await create_runtime_context();
    const task = await create_agent_task(context, {
      name: 'Delete me',
      agent_id: required_agent_id(context),
    });
    const other_task = await create_agent_task(context, {
      name: 'Do not delete',
      agent_id: 'agt_other',
    });

    const deleted = await delete_scheduled_task_tool.execute(
      { scheduled_task_id: task.trigger_id },
      context,
    );
    const blocked = await delete_scheduled_task_tool.execute(
      { scheduled_task_id: other_task.trigger_id },
      context,
    );
    const remaining = await context.db.query.triggers.findMany({
      where: eq(triggers.trigger_id, other_task.trigger_id),
    });

    expect(deleted).toMatchObject({
      success: true,
      data: { scheduled_task_id: task.trigger_id, deleted: true },
    });
    expect(blocked).toMatchObject({
      success: false,
      error: { code: 'not_found' },
    });
    expect(remaining).toHaveLength(1);
  });

  it('says when a new task runs next, in its time zone, as the scheduler then stores it', async () => {
    const context = await create_runtime_context();

    const created = read_task(
      await create_scheduled_task_tool.execute(
        {
          name: 'Weekday list',
          instruction: 'List the three largest files.',
          cron_expression: '0 9 * * 1-5',
          timezone: 'Europe/Rome',
        },
        context,
      ),
    );

    expect(created.next_run_in_task_timezone).toMatch(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday) \d{1,2} [A-Z][a-z]+ \d{4} at 09:\d\d \(Europe\/Rome\)$/,
    );
    expect(new Date(String(created.next_run_time)).getTime()).toBeGreaterThan(Date.now());

    await fire_due_schedule_triggers(context.db);
    const [stored] = await context.db.query.triggers.findMany();
    expect(stored?.next_run_time?.toISOString()).toBe(created.next_run_time);
    const [listed] = read_tasks(
      await list_scheduled_tasks_tool.execute({ include_completed: false }, context),
    );
    expect(listed).toMatchObject({
      next_run_time: created.next_run_time,
      next_run_in_task_timezone: created.next_run_in_task_timezone,
    });
  });

  it('says the new time at once when the schedule is edited, and the scheduler stores the same', async () => {
    const context = await create_runtime_context();
    const created = read_task(
      await create_scheduled_task_tool.execute(
        {
          name: 'Daily report',
          instruction: 'Write the report.',
          cron_expression: '0 9 * * *',
          timezone: 'Europe/Rome',
        },
        context,
      ),
    );
    await fire_due_schedule_triggers(context.db);

    const edited = read_task(
      await edit_scheduled_task_tool.execute(
        {
          scheduled_task_id: String(created.scheduled_task_id),
          cron_expression: '30 14 * * *',
          timezone: 'America/New_York',
        },
        context,
      ),
    );

    expect(edited.next_run_in_task_timezone).toMatch(/ at 14:3\d \(America\/New_York\)$/);
    await fire_due_schedule_triggers(context.db);
    const [stored] = await context.db.query.triggers.findMany();
    expect(stored?.next_run_time?.toISOString()).toBe(edited.next_run_time);
  });

  it('keeps the stored next run when an edit leaves the schedule as it is', async () => {
    const context = await create_runtime_context();
    const created = read_task(
      await create_scheduled_task_tool.execute(
        { name: 'Daily report', instruction: 'Write the report.', cron_expression: '0 9 * * *' },
        context,
      ),
    );
    await fire_due_schedule_triggers(context.db);

    await edit_scheduled_task_tool.execute(
      { scheduled_task_id: String(created.scheduled_task_id), instruction: 'Write it shorter.' },
      context,
    );

    const [stored] = await context.db.query.triggers.findMany();
    expect(stored?.next_run_time?.toISOString()).toBe(created.next_run_time);
  });

  it('says that a paused task has no next run, and the time again when it is resumed', async () => {
    const context = await create_runtime_context();
    const created = read_task(
      await create_scheduled_task_tool.execute(
        { name: 'Daily report', instruction: 'Write the report.', cron_expression: '0 9 * * *' },
        context,
      ),
    );
    const scheduled_task_id = String(created.scheduled_task_id);

    const paused = read_task(await set_status(context, { scheduled_task_id, status: 'disabled' }));
    expect(paused).toMatchObject({
      status: 'disabled',
      next_run_time: null,
      next_run_in_task_timezone: 'none while the task is paused',
    });

    const resumed = read_task(await set_status(context, { scheduled_task_id, status: 'enabled' }));
    expect(resumed).toMatchObject({
      status: 'enabled',
      next_run_time: created.next_run_time,
      next_run_in_task_timezone: created.next_run_in_task_timezone,
    });
  });

  it('says that a task whose time passed while it was paused runs at once', async () => {
    const context = await create_runtime_context();
    const created = read_task(
      await create_scheduled_task_tool.execute(
        {
          name: 'Daily report',
          instruction: 'Write the report.',
          cron_expression: '0 9 * * *',
          timezone: 'UTC',
        },
        context,
      ),
    );
    await context.db
      .update(triggers)
      .set({ next_run_time: new Date('2026-01-05T09:00:00.000Z') })
      .where(eq(triggers.trigger_id, String(created.scheduled_task_id)));

    const [listed] = read_tasks(
      await list_scheduled_tasks_tool.execute({ include_completed: false }, context),
    );

    expect(listed).toMatchObject({
      next_run_time: '2026-01-05T09:00:00.000Z',
      next_run_in_task_timezone:
        'now: it was due on Monday 5 January 2026 at 09:00 (UTC), so it runs within a minute',
    });
  });

  it('says the time of a one-time task in its time zone', async () => {
    const context = await create_runtime_context();
    const run_once_at = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 15, 7, 30));

    const created = read_task(
      await create_scheduled_task_tool.execute(
        {
          name: 'One reminder',
          instruction: 'Remind me.',
          run_once_at: run_once_at.toISOString(),
          timezone: 'Europe/Rome',
        },
        context,
      ),
    );

    expect(created.next_run_time).toBe(run_once_at.toISOString());
    expect(created.next_run_in_task_timezone).toMatch(/ 15 June \d{4} at 09:30 \(Europe\/Rome\)$/);
  });

  it('tells the model that each result holds the next run, and that the time is final', () => {
    expect(create_scheduled_task_tool.description).toContain(
      'That time is final when this tool answers, so never tell the user to check whether the task will run.',
    );
    for (const node_name of [
      'create_scheduled_task',
      'list_scheduled_tasks',
      'edit_scheduled_task',
      'set_scheduled_task_status',
    ]) {
      const tool = scheduled_task_tools.find((candidate) => candidate.node_name === node_name);
      expect(tool?.description, node_name).toContain('next_run_in_task_timezone');
      expect(JSON.stringify(tool?.output_schema), node_name).toContain('next_run_in_task_timezone');
    }
  });

  it('fails visibly when a run has no agent context', async () => {
    const { agent_id: _agent_id, ...context } = await create_runtime_context();

    const result = await create_scheduled_task_tool.execute(
      {
        name: 'No agent',
        instruction: 'This should fail.',
        cron_expression: '0 9 * * *',
      },
      context,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'agent_context_unavailable' },
    });
  });
});

type ToolResult = Awaited<ReturnType<typeof create_scheduled_task_tool.execute>>;

function set_status(
  context: RuntimeToolExecutionContext,
  input: { scheduled_task_id: string; status: 'enabled' | 'disabled' },
) {
  return edit_scheduled_task_tool.execute(input, context);
}

function read_task(result: ToolResult): Record<string, unknown> {
  if (!result.success) throw new Error(`the tool failed: ${result.error.message}`);
  return (result.data as { scheduled_task: Record<string, unknown> }).scheduled_task;
}

function read_tasks(result: ToolResult): Record<string, unknown>[] {
  if (!result.success) throw new Error(`the tool failed: ${result.error.message}`);
  return (result.data as { scheduled_tasks: Record<string, unknown>[] }).scheduled_tasks;
}

async function create_runtime_context(
  input: Pick<RuntimeToolExecutionContext, 'actor_id' | 'source_context'> | undefined = undefined,
): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_tool',
    organization_id: 'org_tool',
    email: 'tool@example.com',
    first_name: 'Tool',
    last_name: 'User',
  });
  await claim_card_unlock(db, workspace.workspace_id);

  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_tool',
    run_id: 'run_tool',
    agent_id: workspace.agent_id,
    actor_id: input?.actor_id ?? workspace.user_id,
    ...(input?.source_context ? { source_context: input.source_context } : {}),
  };
}

async function create_agent_task(
  context: RuntimeToolExecutionContext,
  input: { name: string; agent_id: string },
) {
  return create_trigger(context.db, {
    workspace_id: context.workspace_id,
    agent_id: input.agent_id,
    trigger_name: input.name,
    trigger_type: 'schedule',
    schedule_expression: '0 9 * * 1',
    trigger_config: {
      starts_job_handler: 'run_scheduled_agent_task',
      job_input: { instruction: `Run ${input.name}.` },
    },
    trigger_source: { origin: 'agent_tool' },
    actor_id: context.actor_id,
  });
}

async function record_tool_call(
  context: RuntimeToolExecutionContext,
  tool_name: string,
  tool_input: Record<string, unknown>,
) {
  const call = await create_tool_call_started(context.db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    run_id: context.run_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    tool_name,
    tool_input,
    actor_id: context.actor_id,
  });
  await update_tool_call_finished(context.db, {
    tool_call_id: call.tool_call_id,
    tool_status: 'completed',
    duration_ms: 1,
    actor_id: context.actor_id,
  });
}

function member(input: { user_id: string; timezone: string; is_bot?: boolean }): SlackMember {
  return {
    user_id: input.user_id,
    real_name: input.user_id,
    display_name: null,
    email: null,
    timezone: input.timezone,
    is_bot: input.is_bot ?? false,
    is_guest: false,
  };
}

async function seed_slack_connection(db: RuntimeToolExecutionContext['db'], workspace_id: string) {
  await db.insert(connections).values({
    connection_id: 'conn_tz_test_slack',
    workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack timezone test',
    connection_status: 'active',
    connection_key: 'native:slack:tz-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_TZ',
    external_account_name: 'Timezone test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    credentials: { bot_token: 'tz-test-bot-token' },
    provider_account: { team_id: 'T_TZ' },
    metadata: {},
    created_by: 'user_tool',
    last_updated_by: 'user_tool',
  });
}

function required_agent_id(context: RuntimeToolExecutionContext) {
  if (!context.agent_id) throw new Error('test context is missing agent_id');
  return context.agent_id;
}
