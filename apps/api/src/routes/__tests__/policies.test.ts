import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { events } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const json = { 'Content-Type': 'application/json' };

describe('policy route lifecycle', () => {
  it('writes, reads, audits, and deletes one scoped policy', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const body = {
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: bootstrap.workspace_id,
      policy_mode: 'ask',
    };

    const written = await app.request('/v1/policies', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify(body),
    });
    expect(written.status).toBe(200);
    const written_body = await written.json();
    const policy_id = written_body.data.policy_id as string;

    const listed = await app.request('/v1/policies?scope_type=workspace');
    expect((await listed.json()).data).toMatchObject([{ policy_id, ...body }]);
    const audit_rows = await db.query.events.findMany({
      where: eq(events.event_type, 'policy.changed'),
    });
    expect(audit_rows).toHaveLength(1);
    expect(audit_rows[0]?.event_body).toMatchObject({ action: 'set', policy_id });

    const deleted = await app.request(`/v1/policies/${policy_id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await app.request('/v1/policies')).json()).resolves.toMatchObject({ data: [] });
    const final_audit_rows = await db.query.events.findMany({
      where: eq(events.event_type, 'policy.changed'),
    });
    expect(final_audit_rows.map((event) => event.event_body.action)).toEqual(['set', 'deleted']);
  });

  it('replaces a policy preset in one audited request', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);
    const first_response = await app.request('/v1/policies/batch', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        scope_type: 'workspace',
        scope_id: bootstrap.workspace_id,
        delete_policy_ids: [],
        set_policies: [
          { resource_type: 'node', resource_id: 'gmail-send_email-1', policy_mode: 'never' },
          { resource_type: 'node_label', resource_id: 'changes_things', policy_mode: 'ask' },
        ],
      }),
    });
    const first = (await first_response.json()).data;
    const second_response = await app.request('/v1/policies/batch', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        scope_type: 'workspace',
        scope_id: bootstrap.workspace_id,
        delete_policy_ids: first.written.map((policy: { policy_id: string }) => policy.policy_id),
        set_policies: [
          { resource_type: 'node_label', resource_id: 'every_tool', policy_mode: 'allow' },
          { resource_type: 'node_label', resource_id: 'changes_things', policy_mode: 'ask' },
        ],
      }),
    });
    const listed = await app.request('/v1/policies?scope_type=workspace&limit=500');
    const policy_rows = (await listed.json()).data;
    const audit_rows = await db.query.events.findMany({
      where: eq(events.event_type, 'policy.changed'),
    });

    expect(first_response.status).toBe(200);
    expect(first.written).toHaveLength(2);
    expect(second_response.status).toBe(200);
    expect(
      policy_rows
        .map((policy: { resource_id: string; policy_mode: string }) => ({
          resource_id: policy.resource_id,
          policy_mode: policy.policy_mode,
        }))
        .sort((left: { resource_id: string }, right: { resource_id: string }) =>
          left.resource_id.localeCompare(right.resource_id),
        ),
    ).toEqual([
      { resource_id: 'changes_things', policy_mode: 'ask' },
      { resource_id: 'every_tool', policy_mode: 'allow' },
    ]);
    expect(audit_rows.map((event) => event.event_body.action)).toEqual(['batch', 'batch']);
  });
});

describe('policy route validation', () => {
  it('rejects an invalid policy mode at the HTTP boundary', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const response = await create_app(db).request('/v1/policies', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({
        resource_type: 'node',
        resource_id: 'gmail-send_email-1',
        scope_type: 'workspace',
        scope_id: bootstrap.workspace_id,
        policy_mode: 'sometimes',
      }),
    });
    expect(response.status).toBe(422);
  });
});

describe('approval routes', () => {
  it('describes a held step in words, with the exact input', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    const tool_call = await create_tool_call_started(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      tool_name: 'stripe-refund-1',
      tool_input: { order_id: '4471', amount: 240 },
      tool_status: 'awaiting_approval',
      actor_id: bootstrap.user_id,
    });
    const wait = await create_tool_policy_wait(db, {
      workspace_id: bootstrap.workspace_id,
      queue_key: 'wait:tool_policy:route_test',
      wait: {
        version: 2,
        kind: 'tool_policy_approval',
        session_id: session.session_id,
        source_run_id: run.run_id,
        calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) }],
        requested_by: bootstrap.user_id,
        eligible_user_ids: [bootstrap.user_id],
      },
      actor_id: bootstrap.user_id,
    });

    const response = await create_app(db).request('/v1/approvals?status=waiting');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject([
      {
        job_id: wait.event_job.job_id,
        job_status: 'waiting',
        session_id: session.session_id,
        run_id: run.run_id,
        requested_by: bootstrap.user_id,
        calls: [
          {
            tool_call_id: tool_call.tool_call_id,
            node_key: 'stripe-refund-1',
            tool_status: 'awaiting_approval',
            input: { order_id: '4471', amount: 240 },
          },
        ],
      },
    ]);
  });
});
