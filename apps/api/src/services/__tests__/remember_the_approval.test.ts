import { remember_the_approval } from '@api/services/policies/remember_the_approval';
import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { read_tool_approval_view } from '@runtime-platform/tools/policies/approval_reader_service';
import { build_approval_card } from '@runtime-platform/tools/policies/approval_slack_cards';
import { describe, expect, it } from 'vitest';

const node_key = 'gmail-send_email-1';
const template = { subject: 'Your invoice', body: 'It is attached.' };
const recipients = ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test', 'f@x.test'];

describe('remembering an approval in the size the person chose', () => {
  it('asks once about six identical sends and binds the yes to that message', async () => {
    const fixture = await create_fixture();
    await hold_calls(
      fixture,
      recipients.map((to) => ({ ...template, to })),
    );
    const view = await read_view(fixture);
    const card = build_approval_card(view);

    expect(card.text).toContain('6 recipients');
    expect(read_action_ids(card)).toEqual(['approval_approve_batch', 'approval_refuse']);
    expect(JSON.stringify(card.blocks)).toContain('and 1 more');
    expect(JSON.stringify(card.blocks)).toContain('up to 6 of these a day');

    const wrote = await remember(fixture, view, 'batch');
    expect(wrote.grant_label).toBe('for this exact message, up to 6 a day');
    expect(await read_grant(fixture)).toMatchObject({
      grant_scope: 'task',
      max_per_day: 6,
      template: { fields: ['body', 'subject'] },
      granted_by: fixture.actor.user_id,
    });

    expect(await read_mode(fixture, { ...template, to: 'g@x.test' })).toBe('allow');
    expect(
      await read_mode(fixture, { ...template, subject: 'Something else', to: 'g@x.test' }),
    ).toBe('ask');
  });

  it('lists four sends as one ordinary card', async () => {
    const fixture = await create_fixture();
    await hold_calls(
      fixture,
      recipients.slice(0, 4).map((to) => ({ ...template, to })),
    );
    const card = build_approval_card(await read_view(fixture));
    expect(read_action_ids(card)).toContain('approval_approve');
    expect(read_action_ids(card)).not.toContain('approval_approve_batch');
  });

  it('offers the automation instead of the chat on an automation run, and binds the yes to it', async () => {
    const fixture = await create_fixture({ automation_id: 'atm_invoices' });
    await hold_calls(fixture, [{ ...template, to: recipients[0] }]);
    const view = await read_view(fixture);

    expect(read_action_ids(build_approval_card(view))).toContain('approval_allow_automation');
    expect(read_action_ids(build_approval_card(view))).not.toContain('approval_allow_chat');

    const wrote = await remember(fixture, view, 'automation');
    expect(wrote.grant_label).toBe('inside this automation');
    expect(await read_mode(fixture, { ...template, to: recipients[0] }, 'atm_invoices')).toBe(
      'allow',
    );
    expect(await read_mode(fixture, { ...template, to: recipients[0] }, 'atm_other')).toBe('ask');
  });

  it('gives a deadline the yes with an end date, and writes who gave it', async () => {
    const fixture = await create_fixture();
    await hold_calls(fixture, [{ ...template, to: recipients[0] }]);

    const wrote = await remember(fixture, await read_view(fixture), 'time_bounded');
    expect(wrote.grant_label).toBe('for the next 30 days');
    const grant = await read_grant(fixture);
    expect(grant?.grant_scope).toBe('time_bounded');
    expect(Date.parse(String(grant?.expires_time))).toBeGreaterThan(Date.now());
    expect(grant?.granted_by).toBe(fixture.actor.user_id);
  });

  it('writes nothing when the automation button is pressed on a run with no automation', async () => {
    const fixture = await create_fixture();
    await hold_calls(fixture, [{ ...template, to: recipients[0] }]);

    const wrote = await remember(fixture, await read_view(fixture), 'automation');
    expect(wrote).toEqual({ remembered: null, remembered_in_this_chat: null, grant_label: null });
    expect(await read_grant(fixture)).toBeNull();
  });
});

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function remember(
  fixture: Fixture,
  view: Awaited<ReturnType<typeof read_view>>,
  kind: 'batch' | 'automation' | 'time_bounded',
) {
  return remember_the_approval(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    user_id: fixture.actor.user_id,
    session_id: fixture.session.session_id,
    tool_call_ids: fixture.tool_call_ids,
    kind,
    view,
  });
}

function read_action_ids(card: { blocks: unknown[] }) {
  const actions = card.blocks.find((block) => (block as { type?: string }).type === 'actions');
  const elements = (actions as { elements?: { action_id?: string }[] } | undefined)?.elements ?? [];
  return elements.flatMap((element) => (element.action_id ? [element.action_id] : []));
}

async function read_grant(fixture: Fixture) {
  const row = await fixture.db.query.policies.findFirst({
    where: (table, { eq }) => eq(table.resource_type, 'node'),
  });
  return (row?.metadata as { grant?: Record<string, unknown> } | undefined)?.grant ?? null;
}

function read_mode(fixture: Fixture, tool_input: unknown, automation_id?: string) {
  return resolve_tool_policy_mode(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
    ...(automation_id ? { automation_id } : {}),
    tool: { node_key, connection_id: null, approval_policy: null, metadata: null, tool_input },
  });
}

async function read_view(fixture: Fixture) {
  const view = await read_tool_approval_view(fixture.db, fixture.actor.workspace_id, fixture.wait);
  if (!view) throw new Error('the held step has no view');
  return view;
}

async function hold_calls(fixture: Fixture, inputs: readonly Record<string, unknown>[]) {
  for (const tool_input of inputs) {
    const call = await create_tool_call_started(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      tool_name: node_key,
      tool_input,
      tool_status: 'awaiting_approval',
      actor_id: fixture.actor.user_id,
    });
    fixture.tool_call_ids.push(call.tool_call_id);
  }
  const created = await create_tool_policy_wait(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    queue_key: `wait:tool_policy:${fixture.run.run_id}`,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: fixture.session.session_id,
      source_run_id: fixture.run.run_id,
      calls: fixture.tool_call_ids.map((tool_call_id) => ({
        tool_call_id,
        input_sha256: 'a'.repeat(64),
      })),
      requested_by: fixture.actor.user_id,
      eligible_user_ids: [fixture.actor.user_id],
    },
    actor_id: fixture.actor.user_id,
  });
  fixture.wait = created.event_job;
}

async function create_fixture(input: { automation_id?: string } = {}) {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'schedule',
    ...(input.automation_id ? { automation_id: input.automation_id } : {}),
    actor_id: actor.user_id,
  });
  return {
    db,
    actor,
    session,
    run,
    tool_call_ids: [] as string[],
    wait: null as unknown as Awaited<ReturnType<typeof create_tool_policy_wait>>['event_job'],
  };
}
