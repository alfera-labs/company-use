import { resolve_tool_policy_mode } from '@coworker/core/access/resolve_tool_policies';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { hash_tool_input_for_approval } from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_session } from '@coworker/core/db/queries/sessions';
import { tool_calls } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const node_key = 'gmail-send_email-1';
const emails_outsiders_asks = 'ask';

describe('scoped grants on a policies row', () => {
  it('stops applying once it has expired', async () => {
    const fixture = await create_fixture();
    await write_grant(fixture, { grant_scope: 'time_bounded', expires_time: hours_from_now(-1) });

    expect(await resolve(fixture, { to: 'anna@example.com' })).toBe(emails_outsiders_asks);

    await write_grant(fixture, { grant_scope: 'time_bounded', expires_time: hours_from_now(1) });
    expect(await resolve(fixture, { to: 'anna@example.com' })).toBe('allow');
  });

  it('does not apply to a call its selector does not match', async () => {
    const fixture = await create_fixture();
    await write_grant(fixture, {
      grant_scope: 'perpetual',
      subject_selector: [{ field: 'to', operation: 'contains_any_of', values: ['@example.org'] }],
    });

    expect(await resolve(fixture, { to: 'robin@example.org' })).toBe('allow');
    expect(await resolve(fixture, { to: 'someone@example.com' })).toBe(emails_outsiders_asks);
  });

  it('covers a domain by its host, so a lookalike domain is not covered', async () => {
    const fixture = await create_fixture();
    await write_grant(fixture, { grant_scope: 'perpetual', address_domains: ['acme.com'] });

    expect(await resolve(fixture, { to: 'bob@acme.com' })).toBe('allow');
    expect(await resolve(fixture, { to: 'bob@mail.acme.com' })).toBe('allow');
    expect(await resolve(fixture, { to: 'bob@acme.com.evil.io' })).toBe(emails_outsiders_asks);
    expect(await resolve(fixture, { to: 'acme.com@evil.io' })).toBe(emails_outsiders_asks);
    expect(await resolve(fixture, { to: 'bob@other.com' })).toBe(emails_outsiders_asks);
    expect(await resolve(fixture, { to: ['bob@acme.com', 'eve@evil.io'] })).toBe(
      emails_outsiders_asks,
    );
    expect(await resolve(fixture, { subject: 'no address here' })).toBe(emails_outsiders_asks);
  });

  it('applies only inside the automation it was written for', async () => {
    const fixture = await create_fixture();
    await write_grant(fixture, { grant_scope: 'task', automation_id: 'atm_invoices' });

    expect(await resolve(fixture, { to: 'anna@example.com' }, 'atm_invoices')).toBe('allow');
    expect(await resolve(fixture, { to: 'anna@example.com' }, 'atm_other')).toBe(
      emails_outsiders_asks,
    );
    expect(await resolve(fixture, { to: 'anna@example.com' })).toBe(emails_outsiders_asks);
  });

  it('covers only calls whose template matches, and only up to the daily cap', async () => {
    const fixture = await create_fixture();
    const template = { subject: 'Invoice', body: 'Your invoice is attached.' };
    await write_grant(fixture, {
      grant_scope: 'task',
      template: {
        fields: ['body', 'subject'],
        sha256: hash_tool_input_for_approval({ body: template.body, subject: template.subject }),
      },
      max_per_day: 2,
    });

    expect(await resolve(fixture, { ...template, to: 'anna@example.com' })).toBe('allow');
    expect(await resolve(fixture, { ...template, subject: 'Hello', to: 'anna@example.com' })).toBe(
      emails_outsiders_asks,
    );

    await record_calls_today(fixture, 2);
    expect(await resolve(fixture, { ...template, to: 'anna@example.com' })).toBe(
      emails_outsiders_asks,
    );
  });

  it('leaves a policy written before grants existed unconditional', async () => {
    const fixture = await create_fixture();
    await set_policy(fixture.db, {
      ...fixture.rule,
      policy_mode: 'allow',
      metadata: {},
      actor_id: fixture.actor_id,
    });
    expect(await resolve(fixture, { to: 'anna@example.com' }, 'atm_anything')).toBe('allow');
  });
});

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function create_fixture() {
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
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    session_id: session.session_id,
    rule: {
      workspace_id: bootstrap.workspace_id,
      resource_type: 'node',
      resource_id: node_key,
      scope_type: 'workspace' as const,
      scope_id: bootstrap.workspace_id,
    },
  };
}

async function write_grant(fixture: Fixture, grant: Record<string, unknown>) {
  await set_policy(fixture.db, {
    ...fixture.rule,
    policy_mode: 'allow',
    metadata: {
      grant: { ...grant, granted_by: fixture.actor_id, granted_time: hours_from_now(-2) },
    },
    actor_id: fixture.actor_id,
  });
}

async function resolve(fixture: Fixture, tool_input: unknown, automation_id?: string) {
  return resolve_tool_policy_mode(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.actor_id,
    ...(automation_id ? { automation_id } : {}),
    tool: { node_key, connection_id: null, approval_policy: null, metadata: null, tool_input },
  });
}

async function record_calls_today(fixture: Fixture, how_many: number) {
  for (let index = 0; index < how_many; index += 1) {
    await fixture.db.insert(tool_calls).values({
      tool_call_id: create_id(id_prefixes.tool_call),
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      run_id: create_id(id_prefixes.run),
      agent_id: fixture.agent_id,
      tool_name: node_key,
      tool_status: 'completed',
      created_by: fixture.actor_id,
      last_updated_by: fixture.actor_id,
    });
  }
}

function hours_from_now(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
