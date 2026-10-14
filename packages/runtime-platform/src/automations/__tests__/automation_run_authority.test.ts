import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import { update_agent_enabled_nodes } from '@coworker/core/db/queries/connection_management';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { create_run } from '@coworker/core/db/queries/sessions';
import { events, nodes, workspaces } from '@coworker/core/db/schema';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { record_the_answer } from '@runtime-platform/tools/policies/answer_from_the_person';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { start_agent_run } = vi.hoisted(() => ({
  start_agent_run: vi.fn(async (_db: unknown, _input: StartAgentRunInput) => ({
    run_id: 'run_started',
    run_status: 'completed',
  })),
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const { run_automation_job } = await import('@runtime-platform/events/run_automation_job');
const { create_fixture, insert_attio_connection, stub_composio_api } = await import(
  '@runtime-platform/__tests__/composio_execution_fixture'
);
const { reset_composio_client_for_tests } = await import(
  '@runtime-platform/composio/composio_client'
);

const automation_instruction = 'Answer billing questions and send the customer an invoice.';
const send_node_key = 'gmail-send_email-1';

describe('an automation run that needs a person', () => {
  beforeEach(() => {
    start_agent_run.mockClear();
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('carries the creator into the session, holds the call for them, and runs it once they say yes', async () => {
    const world = await open_a_automation_that_fired();

    expect(world.trigger.trigger_source).toMatchObject({
      origin: 'automation',
      delegated_authority: { kind: 'scheduled_task', granted_by_actor_id: world.user_id },
    });

    expect(world.started.actor_id).toBe('system:trigger');
    expect(world.started.trigger_type).toBe('manual');
    expect(world.source_metadata.delegated_authority).toMatchObject({
      granted_by_actor_id: world.user_id,
      trigger_id: world.trigger.trigger_id,
    });
    expect(world.started.run_metadata).toMatchObject({
      delegated_authority: world.source_metadata.delegated_authority,
    });

    const call = {
      tool_call_id: 'call_1',
      tool_name: 'runtime-execute_tool-1',
      input: { node_key: send_node_key, input: mail_input },
    };
    const decision = await world.policy.decide([call]);
    expect(decision.kind).toBe('needs_approval');

    const waits = await list_tool_policy_waits(world.fixture.db, {
      workspace_id: world.workspace_id,
      status: 'waiting',
    });
    expect(waits).toHaveLength(1);
    expect(waits[0]?.metadata.policy_approval).toMatchObject({
      eligible_user_ids: [world.user_id],
    });

    const wait = waits[0];
    if (!wait || decision.kind !== 'needs_approval') throw new Error('nothing was held');
    await record_the_answer(world.fixture.db, {
      workspace_id: world.workspace_id,
      job_id: wait.job_id,
      queue_key: wait.awaits_queue_key ?? wait.queue_key,
      decided_by: world.user_id,
      decision: 'approved',
    });
    expect(await decision.wait_for_answer()).toMatchObject({ answer: 'approved' });

    const { requests } = stub_composio_api([
      { path: '/tools/execute/GMAIL_SEND_EMAIL', respond: { body: send_response } },
    ]);
    const result = await world.execute_tool(
      { node_key: send_node_key, input: mail_input },
      {
        run_key: world.run_id,
        session_key: world.session_id,
        tool_call_id: 'call_1',
        metadata: {},
      },
    );

    expect(result).toMatchObject({ ok: true, content_json: { node_key: send_node_key } });
    expect(requests).toHaveLength(1);
  });

  it('refuses the same call when the automation text no longer matches the grant', async () => {
    const world = await open_a_automation_that_fired({
      rewrite_instruction_without_resigning: true,
    });

    expect(world.source_metadata.delegated_authority).toBeUndefined();

    const result = await world.execute_tool(
      { node_key: send_node_key, input: mail_input },
      {
        run_key: world.run_id,
        session_key: world.session_id,
        tool_call_id: 'call_2',
        metadata: {},
      },
    );

    expect(result).toMatchObject({ ok: false, error_code: 'approval_required' });
  });
});

const mail_input = { recipient_email: 'sam@example.com', body: 'Here is your invoice.' };
const send_response = { successful: true, data: { id: 'msg_sent' }, log_id: 'log_1' };

async function open_a_automation_that_fired(
  options: { rewrite_instruction_without_resigning?: boolean } = {},
) {
  const fixture = await create_fixture();
  const { workspace_id, agent_id, user_id } = fixture.bootstrap;
  await insert_attio_connection(fixture);
  await seed_outbound_mail_node(fixture);
  await fixture.db
    .update(workspaces)
    .set({ created_time: new Date('2026-01-01T00:00:00Z') })
    .where(eq(workspaces.workspace_id, workspace_id));

  const created = await read_automation_lifecycle().create_automation(fixture.db, {
    workspace_id,
    agent_id,
    actor_id: user_id,
    automation_name: 'Billing desk',
    instruction: automation_instruction,
    triggers: [{ kind: 'manual' }],
  });
  const trigger = created.triggers[0];
  if (!trigger) throw new Error('the automation grew no trigger');

  if (options.rewrite_instruction_without_resigning) {
    await fixture.db.execute(
      `update automations set instruction = 'Send whatever you like.' where automation_id = '${created.automation.automation_id}'`,
    );
  }

  const started = await fire_the_automation(fixture, trigger.trigger_id);
  const source_metadata = started.user_message_source_metadata as RuntimeToolSourceMetadata;
  const session_id = started.session_id;
  const run = await create_run(fixture.db, {
    workspace_id,
    session_id,
    agent_id,
    trigger_type: 'schedule',
    actor_id: 'system:trigger',
  });

  const tool_context = {
    workspace_id,
    session_id,
    run_id: run.run_id,
    agent_id,
    actor_id: 'system:trigger',
    source_context: { source_type: 'runtime' as const, source_metadata },
  };
  const policy = create_tool_batch_policy(fixture.db, tool_context);
  const tools = create_runtime_tool_definitions(fixture.db, {
    ...tool_context,
    read_approval_grant: policy.read_approval_grant,
  });
  policy.set_run_tools(tools);
  const transport = tools.find((tool) => tool.tool_name === 'runtime-execute_tool-1')?.execute;
  if (!transport) throw new Error('this run cannot reach the catalog');

  return {
    fixture,
    workspace_id,
    user_id,
    trigger,
    started,
    source_metadata,
    session_id,
    run_id: run.run_id,
    policy,
    execute_tool: transport,
  };
}

async function fire_the_automation(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  trigger_id: string,
) {
  const [event] = await fixture.db
    .insert(events)
    .values({
      event_id: 'evt_manual_fire',
      workspace_id: fixture.bootstrap.workspace_id,
      source: 'trigger',
      source_event_id: `${trigger_id}:fire_1`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${trigger_id}`,
      actor_key: 'system:trigger',
      event_body: { trigger_id, occurrence_key: 'manual:fire_1' },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('the fire was not written');

  const result = await run_automation_job({
    db: fixture.db,
    workspace_id: fixture.bootstrap.workspace_id,
    events: [event],
  });
  expect(result.result_data).toMatchObject({ ran: true });

  const started = start_agent_run.mock.calls.at(-1)?.[1];
  if (!started) throw new Error('no run was started');
  return started;
}

async function seed_outbound_mail_node(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  const { user_id, workspace_id, agent_id } = fixture.bootstrap;
  const existing = await fixture.db.query.nodes.findFirst({
    where: eq(nodes.node_key, 'attio-list_records-1'),
  });
  if (!existing) throw new Error('the Composio fixture seeded no nodes');
  await fixture.db.insert(nodes).values({
    ...existing,
    node_id: 'node_gmail_send_email',
    node_name: 'send_email',
    node_key: send_node_key,
    node_display_name: 'Send an email',
    approval_policy: { mode: 'manual_review' },
    runtime_handler: 'composio.GMAIL_SEND_EMAIL',
    input_schema: {
      type: 'object',
      properties: { recipient_email: { type: 'string' }, body: { type: 'string' } },
      required: ['recipient_email', 'body'],
      additionalProperties: false,
    },
    node_config: {
      ...existing.node_config,
      composio: { toolkit_slug: 'attio', tool_slug: 'GMAIL_SEND_EMAIL' },
    },
  });
  await update_agent_enabled_nodes(fixture.db, {
    workspace_id,
    agent_id,
    actor_id: user_id,
    enabled_nodes: [
      {
        node_key: send_node_key,
        provider_key: 'composio',
        status: 'enabled',
        connection_selector: { strategy: 'latest_active_matching_connection' },
        input_defaults: {},
        approval_policy_override: null,
      },
    ],
  });
}
