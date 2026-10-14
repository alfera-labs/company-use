import { always_allow_tool_calls } from '@api/services/policies/always_allow_tool_node';
import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_policy } from '@coworker/core/db/queries/policies';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { connections } from '@coworker/core/db/schema';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { describe, expect, it } from 'vitest';

const connection_id = 'conn_always_allow_test';

describe('remembering a tool for next time', () => {
  it('answers the workspace that asked, even though the call ran through a connection', async () => {
    const fixture = await create_fixture();
    const held = await hold_a_call(fixture, {
      tool_name: 'gmail-send_email-1',
      approval_labels: ['every_tool', 'changes_things', 'emails_outsiders'],
    });
    expect(await read_mode(fixture, 'gmail-send_email-1')).toBe('ask');

    expect(await always_allow(fixture, held)).toEqual({ remembered: true, policy_count: 1 });

    expect(await read_mode(fixture, 'gmail-send_email-1')).toBe('allow');
    expect(await read_written_policies(fixture)).toEqual([
      { scope_type: 'workspace', scope_id: fixture.actor.workspace_id, policy_mode: 'allow' },
    ]);
  });

  it('answers a workspace rule about a kind of tool with a rule about this tool', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, { resource_type: 'node_label', resource_id: 'changes_things' });
    const held = await hold_a_call(fixture, {
      tool_name: 'linear-create_issue-1',
      approval_labels: ['every_tool', 'changes_things'],
    });
    expect(await read_mode(fixture, 'linear-create_issue-1')).toBe('ask');

    expect(await always_allow(fixture, held)).toEqual({ remembered: true, policy_count: 1 });

    expect(await read_mode(fixture, 'linear-create_issue-1')).toBe('allow');
    expect(await read_mode(fixture, 'linear-delete_issue-1')).toBe('ask');
  });

  it('answers at the connection that asked, and leaves the workspace alone', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, {
      resource_type: 'node_label',
      resource_id: 'changes_things',
      scope_type: 'connection',
      scope_id: connection_id,
    });
    const held = await hold_a_call(fixture, {
      tool_name: 'linear-create_issue-1',
      approval_labels: ['every_tool', 'changes_things'],
    });

    expect(await always_allow(fixture, held)).toEqual({ remembered: true, policy_count: 1 });

    expect(await read_mode(fixture, 'linear-create_issue-1')).toBe('allow');
    expect(await read_written_policies(fixture)).toEqual([
      { scope_type: 'connection', scope_id: connection_id, policy_mode: 'allow' },
    ]);
  });

  it('writes nothing when no scope was asking', async () => {
    const fixture = await create_fixture();
    const held = await hold_a_call(fixture, {
      tool_name: 'linear-create_issue-1',
      approval_labels: ['every_tool', 'changes_things'],
    });

    expect(await always_allow(fixture, held)).toEqual({
      remembered: false,
      reason: 'nothing_to_remember',
    });
    expect(await read_written_policies(fixture)).toEqual([]);
  });

  it('refuses to answer a ban', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, {
      resource_type: 'node_label',
      resource_id: 'changes_things',
      policy_mode: 'never',
    });
    const held = await hold_a_call(fixture, {
      tool_name: 'linear-create_issue-1',
      approval_labels: ['every_tool', 'changes_things'],
    });

    expect(await always_allow(fixture, held)).toEqual({
      remembered: false,
      reason: 'banned_outright',
    });
    expect(await read_mode(fixture, 'linear-create_issue-1')).toBe('never');
  });
});

function always_allow(fixture: Fixture, tool_call_id: string) {
  return always_allow_tool_calls(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    user_id: fixture.actor.user_id,
    session_id: fixture.session.session_id,
    tool_call_ids: [tool_call_id],
  });
}

async function hold_a_call(
  fixture: Fixture,
  input: { tool_name: string; approval_labels: string[] },
) {
  const call = await create_tool_call_started(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    tool_name: input.tool_name,
    tool_input: { title: 'A held call' },
    tool_status: 'awaiting_approval',
    tool_call_metadata: { connection_id, approval_labels: input.approval_labels },
    actor_id: fixture.actor.user_id,
  });
  return call.tool_call_id;
}

function read_mode(fixture: Fixture, node_key: string) {
  return resolve_tool_policy_mode(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
    tool: {
      node_key,
      connection_id,
      approval_policy: null,
      metadata: { policy_labels: ['every_tool', 'changes_things'] },
    },
  });
}

async function read_written_policies(fixture: Fixture) {
  const rows = await fixture.db.query.policies.findMany({
    where: (table, { eq }) => eq(table.resource_type, 'node'),
  });
  return rows.map((row) => ({
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    policy_mode: row.policy_mode,
  }));
}

function ask_before(
  fixture: Fixture,
  rule: {
    resource_type: string;
    resource_id: string;
    scope_type?: 'workspace' | 'connection';
    scope_id?: string;
    policy_mode?: 'ask' | 'never';
  },
) {
  return set_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    resource_type: rule.resource_type,
    resource_id: rule.resource_id,
    scope_type: rule.scope_type ?? 'workspace',
    scope_id: rule.scope_id ?? fixture.actor.workspace_id,
    policy_mode: rule.policy_mode ?? 'ask',
    actor_id: fixture.actor.user_id,
  });
}

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!app) throw new Error('App seed missing');
  await db.insert(connections).values({
    connection_id,
    workspace_id: actor.workspace_id,
    app_id: app.app_id,
    connection_key: `native:slack:${connection_id}`,
    connection_name: connection_id,
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: `T_${connection_id}`,
    authorized_scopes: ['channels:read'],
    health_status: 'healthy',
    connection_config: {},
    created_by: actor.user_id,
    last_updated_by: actor.user_id,
  });
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  return { db, actor, session, run };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;
