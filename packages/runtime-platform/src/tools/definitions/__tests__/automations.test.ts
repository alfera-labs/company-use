import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { apps, connections, nodes, resource_grants } from '@coworker/core/db/schema';
import { create_id, id_prefixes, scout_actor } from '@coworker/shared';
import { agent_automation_limit } from '@runtime-platform/tools/definitions/automations_support';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };
const composio_calls: Array<{ method: string; path: string; body: unknown }> = [];
const composio_answers: Record<string, unknown> = {
  POST: { trigger_id: 'wire_test' },
  PATCH: {},
  DELETE: { success: true },
};

async function answer_composio(url: URL | RequestInfo, init?: RequestInit) {
  const request_url = new URL(String(url));
  if (request_url.host !== 'backend.composio.dev') {
    throw new Error(`Unexpected request to ${request_url.href}`);
  }
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  composio_calls.push({ method, path: request_url.pathname, body });
  return Response.json(composio_answers[method] ?? {});
}

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
  create_automation_tool,
  delete_automation_tool,
  edit_automation_tool,
  list_automations_tool,
  list_trigger_types_tool,
  run_automation_now_tool,
  set_automation_status_tool,
} = await import('@runtime-platform/tools/definitions/automations');

beforeEach(() => {
  composio_calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(answer_composio));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const gmail_node_key = 'composio_gmail-new_gmail_message-1';

const billing_automation = {
  name: 'Answer billing questions',
  instruction: 'Read the message and draft a reply. Every reply is proposed before it is sent.',
  triggers: [
    { kind: 'schedule' as const, cron: '0 9 * * 1-5', timezone: 'Europe/London' },
    {
      kind: 'app_event' as const,
      node_key: gmail_node_key,
      subscription_config: { labelIds: 'INBOX' },
      conditions: [
        { field: 'sender', operation: 'does_not_contain_any_of' as const, values: ['no-reply'] },
      ],
    },
    { kind: 'manual' as const },
  ],
  judge_question: 'Is this a customer asking about an invoice?',
  run_at_or_above: 60,
};

describe('automation runtime tools', () => {
  it('writes one automation, one trigger per ear, and keys its sessions by the mail thread', async () => {
    const context = await create_runtime_context();

    const result = await create_automation_tool.execute(billing_automation, context);
    const rows = await context.db.query.triggers.findMany({
      where: (table, { eq: is }) => is(table.automation_id, read_automation_id(result)),
    });
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id: read_automation_id(result),
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        automation: {
          name: 'Answer billing questions',
          status: 'enabled',
          created_via: 'agent_tool',
          subject_from: 'thread_id',
        },
      },
    });
    expect(automation?.conditions).toEqual([
      { field: 'sender', operation: 'address_is_not_any_of', values: ['automation@example.com'] },
      { field: 'payload.headers', operation: 'header_missing', values: ['List-Unsubscribe'] },
      { field: 'sender', operation: 'does_not_contain_any_of', values: ['no-reply', 'noreply'] },
    ]);
    expect(automation?.judge).toEqual({
      question: 'Is this a customer asking about an invoice?',
      run_at_or_above: 60,
    });
    expect(rows.map((row) => row.trigger_type).sort()).toEqual(['app_event', 'manual', 'schedule']);
    expect(rows.every((row) => row.automation_id === automation?.automation_id)).toBe(true);
    expect(composio_calls).toContainEqual({
      method: 'POST',
      path: '/api/v3.1/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert',
      body: {
        connected_account_id: 'account_wire',
        trigger_config: { labelIds: 'INBOX' },
        toolkit_versions: 'latest',
      },
    });
  });

  it('takes no app list on create or edit, and stores the empty default', async () => {
    const context = await create_runtime_context();
    const with_apps = { ...billing_automation, uses_tools: ['composio_gmail'] };

    expect(create_automation_tool.validate_input?.safeParse(with_apps).success).toBe(false);
    expect(
      edit_automation_tool.validate_input?.safeParse({
        automation_id: 'atm_1',
        uses_tools: ['composio_gmail'],
      }).success,
    ).toBe(false);
    const result = await create_automation_tool.execute(billing_automation, context);
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id: read_automation_id(result),
    });
    expect(automation?.uses_tools).toEqual({ apps: [] });
  });

  it('reads the automation back as when, then, and how the person hears about it', async () => {
    const context = await create_runtime_context();

    const result = await create_automation_tool.execute(billing_automation, context);
    const readback = read_data(result).readback as string;

    expect(readback).toContain('When: every weekday at 09:00 (Europe/London)');
    expect(readback).toContain('on "New Gmail message received" in Gmail');
    expect(readback).not.toContain(gmail_node_key);
    expect(readback).not.toContain('Not listening yet');
    expect(readback).toContain('Then: Read the message and draft a reply.');
    expect(readback).toContain('Tell you: per your attention settings.');
  });

  it('refuses a trigger that leaves out a setup field its node requires, naming the field', async () => {
    const context = await create_runtime_context();
    await seed_stripe_catalog(context.db);

    const result = await create_automation_tool.execute(
      {
        name: 'Chase failed payments',
        instruction: 'Tell me when a charge fails.',
        triggers: [{ kind: 'app_event', node_key: stripe_node_key }],
      },
      context,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'validation_error', message: expect.stringContaining('mode') },
    });
    expect(await context.db.query.automations.findMany()).toHaveLength(0);
  });

  it('says a trigger is waiting for its app to be connected', async () => {
    const context = await create_runtime_context();
    await seed_stripe_catalog(context.db);

    const result = await create_automation_tool.execute(
      {
        name: 'Chase failed payments',
        instruction: 'Tell me when a charge fails.',
        triggers: [
          { kind: 'app_event', node_key: stripe_node_key, subscription_config: { mode: 'live' } },
        ],
      },
      context,
    );
    const data = read_data(result);

    expect(data.automation).toMatchObject({
      triggers: [{ status: 'error', problem: 'Waiting for Stripe to be connected' }],
    });
    expect(data.readback).toContain('Not listening yet: Waiting for Stripe to be connected.');
  });

  it('lets the agent keep ten automations of its own and refuses the eleventh', async () => {
    const context = await create_runtime_context();
    for (let index = 0; index < agent_automation_limit; index += 1) {
      await create_automation(context.db, {
        workspace_id: context.workspace_id,
        agent_id: required_agent_id(context),
        automation_name: `Watcher ${index}`,
        instruction: 'Watch something.',
        created_via: 'agent_tool',
        actor_id: context.actor_id,
      });
    }

    const result = await create_automation_tool.execute(
      {
        name: 'One too many',
        instruction: 'Watch one more thing.',
        triggers: [{ kind: 'manual' }],
      },
      context,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'automation_limit_reached' },
    });
    expect(await context.db.query.automations.findMany()).toHaveLength(agent_automation_limit);
  });

  it('keeps the conditions when only the judge question is edited', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(
      {
        ...billing_automation,
        rules: [{ field: 'sender', operation: 'is_present' }],
      },
      context,
    );
    const automation_id = read_automation_id(created);

    const edited = await edit_automation_tool.execute(
      { automation_id, judge_question: 'Is this a customer asking about a 2027 invoice?' },
      context,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id,
    });

    expect(edited).toMatchObject({ success: true });
    expect(automation?.conditions).toEqual([{ field: 'sender', operation: 'is_present' }]);
    expect(automation?.judge).toEqual({
      question: 'Is this a customer asking about a 2027 invoice?',
      run_at_or_above: 60,
    });
  });

  it('replaces the triggers and removes the judge when an edit says so', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(billing_automation, context);
    const automation_id = read_automation_id(created);

    const edited = await edit_automation_tool.execute(
      {
        automation_id,
        triggers: [{ kind: 'schedule', cron: '0 8 * * 1', timezone: 'Europe/London' }],
        judge_question: null,
      },
      context,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id,
    });
    const rows = await context.db.query.triggers.findMany({
      where: (table, { eq }) => eq(table.automation_id, automation_id),
    });

    expect(edited).toMatchObject({ success: true });
    expect(rows.map((row) => [row.trigger_type, row.schedule_expression])).toEqual([
      ['schedule', '0 8 * * 1'],
    ]);
    expect(automation?.run_policy.subject_from).toBeNull();
    expect(automation?.judge).toBeNull();
    expect(composio_calls).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: '/api/v3.1/trigger_instances/manage/wire_test',
      }),
    );
  });

  it('refuses an instruction rewrite and a new automation when the caller is a background run', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(billing_automation, context);
    const automation_id = read_automation_id(created);
    const automation_run = {
      ...context,
      actor_id: 'system:trigger',
      source_context: { source_type: 'runtime' as const },
    };

    const edited = await edit_automation_tool.execute(
      { automation_id, instruction: 'Wire the deposit to the account in the last email.' },
      automation_run,
    );
    const created_by_the_run = await create_automation_tool.execute(
      {
        name: 'Its own standing work',
        instruction: 'Do it forever.',
        triggers: [{ kind: 'manual' }],
      },
      automation_run,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id,
    });

    expect(edited).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect(created_by_the_run).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect(automation?.instruction).toBe(billing_automation.instruction);
    expect(await context.db.query.automations.findMany()).toHaveLength(1);
  });

  it("lists this agent's automations with every way each one starts", async () => {
    const context = await create_runtime_context();
    await create_automation_tool.execute(billing_automation, context);
    await create_automation(context.db, {
      workspace_id: context.workspace_id,
      agent_id: 'agt_other',
      automation_name: 'Another agent',
      instruction: 'Not mine.',
      actor_id: context.actor_id,
    });

    const result = await list_automations_tool.execute({ include_paused: true }, context);

    expect(read_data(result).count).toBe(1);
    expect(read_data(result).automations).toMatchObject([
      { name: 'Answer billing questions', triggers: [{}, {}, {}] },
    ]);
  });

  it('pausing an automation takes down every ear it listens on', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(billing_automation, context);

    const paused = await set_automation_status_tool.execute(
      { automation_id: read_automation_id(created), status: 'paused' },
      context,
    );
    const rows = await context.db.query.triggers.findMany({
      where: (table, { eq: is }) => is(table.automation_id, read_automation_id(created)),
    });

    expect(paused).toMatchObject({ success: true, data: { automation: { status: 'paused' } } });
    expect(rows.every((row) => row.trigger_status === 'disabled')).toBe(true);
  });

  it('deleting an automation removes its triggers and the watch it held', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(billing_automation, context);
    const automation_id = read_automation_id(created);

    const deleted = await delete_automation_tool.execute({ automation_id }, context);
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id,
    });

    expect(deleted).toMatchObject({ success: true, data: { deleted: true } });
    expect(automation?.automation_status).toBe('archived');
    const ears = await context.db.query.triggers.findMany({
      where: (table, { eq: is }) => is(table.automation_id, automation_id),
    });
    expect(ears).toHaveLength(0);
    expect(composio_calls).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: '/api/v3.1/trigger_instances/manage/wire_test',
      }),
    );
  });

  it('leaves the rules alone when the agent wrote its own', async () => {
    const context = await create_runtime_context();
    const own_rules = [
      { field: 'sender', operation: 'contains_any_of' as const, values: ['newsletter'] },
    ];

    const result = await create_automation_tool.execute(
      { ...billing_automation, rules: own_rules },
      context,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id: read_automation_id(result),
    });

    expect(automation?.conditions).toEqual(own_rules);
  });

  it('running an automation now fires it through the same event pipeline', async () => {
    const context = await create_runtime_context();
    const created = await create_automation_tool.execute(billing_automation, context);
    const automation_id = read_automation_id(created);

    const started = await run_automation_now_tool.execute({ automation_id }, context);
    const event_rows = await context.db.query.events.findMany();

    expect(started).toMatchObject({ success: true, data: { automation_id, started: true } });
    expect(event_rows).toHaveLength(1);
    expect(event_rows[0]?.queue_key).toContain(`automation:${automation_id}:subject:`);
  });

  it('lets a background run retire the watchers it made itself', async () => {
    const context = await create_runtime_context();
    const own_watcher = await create_automation(context.db, {
      workspace_id: context.workspace_id,
      agent_id: required_agent_id(context),
      automation_name: 'Watch for the vendor reply',
      instruction: 'Tell me when the vendor replies.',
      created_via: 'agent_tool',
      actor_id: 'system:trigger',
    });
    const follow_up = await create_automation(context.db, {
      workspace_id: context.workspace_id,
      agent_id: required_agent_id(context),
      automation_name: 'Chase the deposit',
      instruction: 'Chase the deposit until it lands.',
      created_via: 'agent_tool',
      metadata: { parent_automation_id: 'atm_parent', expires_with_parent: true },
      actor_id: context.actor_id,
    });
    const background_run = {
      ...context,
      actor_id: scout_actor,
      source_context: { source_type: 'runtime' as const },
    };

    const retired_own = await delete_automation_tool.execute(
      { automation_id: own_watcher.automation_id },
      background_run,
    );
    const retired_follow_up = await delete_automation_tool.execute(
      { automation_id: follow_up.automation_id },
      background_run,
    );

    expect(retired_own).toMatchObject({ success: true, data: { deleted: true } });
    expect(retired_follow_up).toMatchObject({ success: true, data: { deleted: true } });
    const rows = await context.db.query.automations.findMany();
    expect(rows.every((row) => row.automation_status === 'archived')).toBe(true);
  });

  it('refuses to retire an automation a person set up, and says how to ask', async () => {
    const context = await create_runtime_context();
    const theirs = await create_automation(context.db, {
      workspace_id: context.workspace_id,
      agent_id: required_agent_id(context),
      automation_name: 'Monday invoice list',
      instruction: 'Send me the unpaid invoices every Monday.',
      created_via: 'user',
      actor_id: context.actor_id,
    });
    const background_run = {
      ...context,
      actor_id: scout_actor,
      source_context: { source_type: 'runtime' as const },
    };

    const refused = await delete_automation_tool.execute(
      { automation_id: theirs.automation_id },
      background_run,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id: theirs.automation_id,
    });

    expect(refused).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect(refused).toMatchObject({
      error: { message: expect.stringContaining('retire_automation') },
    });
    expect(automation?.automation_status).toBe('enabled');
  });

  it('lists the trigger types an automation can listen on, with their event fields', async () => {
    const context = await create_runtime_context();
    await seed_stripe_catalog(context.db);

    const result = await list_trigger_types_tool.execute({}, context);

    expect(read_data(result).trigger_types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: gmail_node_key,
          display_name: 'New Gmail message received',
          setup_fields: [
            {
              name: 'labelIds',
              label: 'Label',
              description:
                'Only emails with this label. For several, use the search above: label:work OR label:clients.',
              required: false,
              type: null,
              has_default: false,
              chip_word: 'in',
              empty_means: null,
              unit: null,
              hidden_at_default: false,
              choices_from_provider: true,
              minimum: null,
            },
          ],
          event_fields: expect.arrayContaining([
            { name: 'thread_id', label: 'Thread id' },
            { name: 'sender', label: 'Sender' },
          ]),
          connected: true,
          connection_id: 'conn_wire',
          connections: [
            { connection_id: 'conn_wire', connection_name: 'Gmail', account_label: null },
          ],
        }),
        expect.objectContaining({
          node_key: stripe_node_key,
          display_name: 'Charge failed',
          display_name_without_app: 'Charge failed',
          setup_fields: [
            {
              name: 'mode',
              label: 'Charge mode',
              description: 'Live or test charges.',
              required: true,
              type: 'string',
              enum: ['live', 'test'],
              has_default: false,
              chip_word: null,
              empty_means: null,
              unit: null,
              hidden_at_default: false,
              choices_from_provider: false,
              minimum: null,
            },
            expect.objectContaining({
              name: 'relative_to',
              label: 'Relative to',
              has_default: true,
            }),
            expect.objectContaining({
              name: 'offsetMinutes',
              label: 'Offset minutes',
              has_default: false,
            }),
          ],
          connected: false,
          connection_id: null,
          connections: [],
        }),
      ]),
    );
  });

  it('refuses to pause or run an automation a person set up when the caller is a background run', async () => {
    const context = await create_runtime_context();
    const theirs = await create_automation(context.db, {
      workspace_id: context.workspace_id,
      agent_id: required_agent_id(context),
      automation_name: 'Monday invoice list',
      instruction: 'Send me the unpaid invoices every Monday.',
      created_via: 'user',
      actor_id: context.actor_id,
    });
    const background_run = {
      ...context,
      actor_id: scout_actor,
      source_context: { source_type: 'runtime' as const },
    };

    const paused = await set_automation_status_tool.execute(
      { automation_id: theirs.automation_id, status: 'paused' },
      background_run,
    );
    const ran = await run_automation_now_tool.execute(
      { automation_id: theirs.automation_id },
      background_run,
    );
    const automation = await get_automation(context.db, {
      workspace_id: context.workspace_id,
      automation_id: theirs.automation_id,
    });

    expect(paused).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect(ran).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect(automation?.automation_status).toBe('enabled');
    expect(await context.db.query.events.findMany()).toHaveLength(0);
  });

  it('lists only the accounts everybody on the run may use', async () => {
    const context = await create_runtime_context();
    await context.db.insert(connections).values({
      connection_id: 'conn_teammate',
      workspace_id: context.workspace_id,
      app_id: 'app_wire',
      connection_key: 'composio_gmail_teammate',
      connection_status: 'active',
      connected_by: 'user_teammate',
      ...audit,
    });
    await context.db.insert(resource_grants).values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: context.workspace_id,
      resource_type: 'connection',
      resource_id: 'conn_teammate',
      grantee_type: 'user',
      grantee_id: 'user_teammate',
      grant_level: 'use',
      ...audit,
    });
    const run = { ...context, participants: { project: [], user: [context.actor_id], agent: [] } };

    const result = await list_trigger_types_tool.execute({}, run);

    const rows = read_data(result).trigger_types as { node_key: string; connections: unknown }[];
    const gmail = rows.find((row) => row.node_key === gmail_node_key);
    expect(gmail?.connections).toEqual([
      { connection_id: 'conn_wire', connection_name: 'Gmail', account_label: null },
    ]);
  });

  it('fails visibly when a run has no agent context', async () => {
    const { agent_id: _agent_id, ...context } = await create_runtime_context();

    const result = await create_automation_tool.execute(
      { name: 'No agent', instruction: 'This should fail.', triggers: [{ kind: 'manual' }] },
      context,
    );

    expect(result).toMatchObject({ success: false, error: { code: 'agent_context_unavailable' } });
  });
});

async function create_runtime_context(): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_automation',
    organization_id: 'org_automation',
    email: 'automation@example.com',
    first_name: 'Automation',
    last_name: 'User',
  });
  await claim_card_unlock(db, workspace.workspace_id);
  await seed_gmail_catalog(db, workspace.workspace_id);

  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_automation',
    run_id: 'run_automation',
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  };
}

async function seed_gmail_catalog(db: RuntimeToolExecutionContext['db'], workspace_id: string) {
  await db.insert(apps).values({
    app_id: 'app_wire',
    app_name: 'composio_gmail',
    app_key: 'composio_gmail',
    app_display_name: 'Gmail',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_wire',
    app_id: 'app_wire',
    app_key: 'composio_gmail',
    node_name: 'new_gmail_message',
    node_key: gmail_node_key,
    node_display_name: 'New Gmail Message Received Trigger',
    node_kind: 'trigger',
    input_schema: { properties: { labelIds: { description: 'Labels to watch.' } } },
    output_schema: { properties: { thread_id: {}, sender: {} } },
    runtime_handler: 'composio.trigger.GMAIL_NEW_GMAIL_MESSAGE',
    node_config: {
      composio: { toolkit_slug: 'composio_gmail', trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
      sourced_from: { provider: 'composio', provider_app_id: 'gmail' },
      subject_field: 'thread_id',
    },
    ...audit,
  });
  await db.insert(connections).values({
    connection_id: 'conn_wire',
    workspace_id,
    app_id: 'app_wire',
    connection_key: 'composio_gmail',
    connection_status: 'active',
    external_account_id: 'account_wire',
    ...audit,
  });
}

const stripe_node_key = 'composio_stripe-charge_failed-1';

async function seed_stripe_catalog(db: RuntimeToolExecutionContext['db']) {
  await db.insert(apps).values({
    app_id: 'app_stripe',
    app_name: 'composio_stripe',
    app_key: 'composio_stripe',
    app_display_name: 'Stripe',
    auth_type: 'oauth',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_stripe',
    app_id: 'app_stripe',
    app_key: 'composio_stripe',
    node_name: 'charge_failed',
    node_key: stripe_node_key,
    node_display_name: 'Charge failed',
    node_kind: 'trigger',
    input_schema: {
      properties: {
        mode: {
          type: 'string',
          title: 'Charge mode',
          enum: ['live', 'test'],
          description: 'Live or test charges.',
        },
        relative_to: { type: 'string', default: null },
        offsetMinutes: { type: 'number' },
      },
      required: ['mode'],
    },
    output_schema: { properties: { charge_id: {} } },
    runtime_handler: 'composio.trigger.STRIPE_CHARGE_FAILED',
    node_config: {
      composio: { toolkit_slug: 'composio_stripe', trigger_slug: 'STRIPE_CHARGE_FAILED' },
    },
    ...audit,
  });
}

function read_data(result: unknown) {
  const success = result as { success: boolean; data?: Record<string, unknown>; error?: unknown };
  if (!success.success || !success.data) {
    throw new Error(`tool call failed: ${JSON.stringify(success.error)}`);
  }
  return success.data;
}

function read_automation_id(result: unknown) {
  return (read_data(result).automation as { automation_id: string }).automation_id;
}

function required_agent_id(context: RuntimeToolExecutionContext) {
  if (!context.agent_id) throw new Error('test context is missing agent_id');
  return context.agent_id;
}
