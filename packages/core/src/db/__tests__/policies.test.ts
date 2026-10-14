import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_session } from '@coworker/core/db/queries/sessions';
import { describe, expect, it } from 'vitest';

describe('policies', () => {
  it('resolves strictest across scopes and exact before labels', async () => {
    const fixture = await policy_fixture();
    await set_policy(fixture.db, {
      workspace_id: fixture.workspace_id,
      resource_type: 'node_label',
      resource_id: 'changes_things',
      scope_type: 'workspace',
      scope_id: fixture.workspace_id,
      policy_mode: 'never',
      actor_id: fixture.user_id,
    });
    await set_policy(fixture.db, {
      workspace_id: fixture.workspace_id,
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: fixture.workspace_id,
      policy_mode: 'ask',
      actor_id: fixture.user_id,
    });

    expect(await resolve(fixture, 'gmail-send_email-1')).toBe('ask');
    expect(await resolve(fixture, 'gmail-delete_email-1')).toBe('never');
  });

  it('asks for outbound mail and nothing else when no policy exists', async () => {
    const fixture = await policy_fixture();
    expect(await resolve(fixture, 'gmail-send_email-1')).toBe('ask');
    expect(await resolve(fixture, 'gmail-find_email-1')).toBe('allow');
    expect(await resolve(fixture, 'linear-create_issue-1')).toBe('allow');
  });
});

async function policy_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    agent_id: bootstrap.agent_id,
    session_id: session.session_id,
  };
}

function resolve(fixture: Awaited<ReturnType<typeof policy_fixture>>, node_key: string) {
  return resolve_tool_policy_mode(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.user_id,
    tool: {
      node_key,
      approval_policy: { mode: 'manual_review' },
      metadata: {},
    },
  });
}

describe('mail to yourself', () => {
  it('lets a send whose only recipients are workspace members run without asking', async () => {
    const fixture = await policy_fixture();
    const mode = await resolve_tool_policy_mode(fixture.db, {
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      agent_id: fixture.agent_id,
      actor_id: fixture.user_id,
      tool: {
        node_key: 'gmail-send_email-1',
        connection_id: null,
        approval_policy: { mode: 'manual_review' },
        metadata: {},
        tool_input: {
          recipient_email: 'Founder@runtime.local',
          body: 'New mail from client <ceo@acme.com>: please call back',
        },
      },
    });
    expect(mode).toBe('allow');
  });

  it('still asks when any recipient is outside the workspace', async () => {
    const fixture = await policy_fixture();
    const mode = await resolve_tool_policy_mode(fixture.db, {
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      agent_id: fixture.agent_id,
      actor_id: fixture.user_id,
      tool: {
        node_key: 'gmail-send_email-1',
        connection_id: null,
        approval_policy: { mode: 'manual_review' },
        metadata: {},
        tool_input: { to: ['founder@runtime.local', 'ceo@acme.com'], body: 'hi' },
      },
    });
    expect(mode).toBe('ask');
  });
});
