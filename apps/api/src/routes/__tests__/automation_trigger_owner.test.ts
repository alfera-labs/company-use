import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const the_owner = 'user_who_set_it_up';
const owner_rules = [
  { field: 'sender', operation: 'contains_any_of' as const, values: ['@example.com'] },
];

async function create_fixture(role_of_the_caller: 'owner' | 'admin' | 'member') {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await db
    .update(workspace_members)
    .set({ member_role: role_of_the_caller })
    .where(eq(workspace_members.user_id, identity.user_id));
  const shared = { workspace_id: identity.workspace_id, agent_id: identity.agent_id };
  const automation = await create_automation(db, {
    ...shared,
    automation_name: 'Answer the mail of the owner',
    instruction: 'Read the message and draft an answer.',
    actor_id: the_owner,
  });
  const trigger = await create_trigger(db, {
    ...shared,
    automation_id: automation.automation_id,
    trigger_name: 'When mail arrives',
    trigger_type: 'manual',
    trigger_config: { starts_job_handler: 'run_automation', rules: owner_rules },
    actor_id: the_owner,
  });
  const own_task = await create_trigger(db, {
    ...shared,
    trigger_name: 'A task of the caller',
    trigger_type: 'manual',
    trigger_config: { starts_job_handler: 'run_scheduled_agent_task' },
    actor_id: identity.user_id,
  });
  return { db, app: create_app(db), automation, trigger, own_task };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function send(fixture: Fixture, method: string, path: string, body?: unknown) {
  return fixture.app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

describe('the trigger of an automation another person set up', () => {
  it('cannot be changed by a member through the trigger route, the same as through the automation', async () => {
    const fixture = await create_fixture('member');
    const trigger_path = `/v1/triggers/${fixture.trigger.trigger_id}`;

    const through_the_automation = await send(
      fixture,
      'PATCH',
      `/v1/automations/${fixture.automation.automation_id}`,
      { instruction: 'Send every message to me.' },
    );
    const dropped_rules = await send(fixture, 'PATCH', trigger_path, {
      trigger_config: { rules: [] },
    });
    const switched_off = await send(fixture, 'PATCH', trigger_path, {
      trigger_status: 'disabled',
    });
    const stored = await get_trigger_by_id(fixture.db, fixture.trigger.trigger_id);

    expect(through_the_automation.status).toBe(403);
    expect(dropped_rules.status).toBe(403);
    expect(switched_off.status).toBe(403);
    expect((await dropped_rules.json()).error.code).toBe('automation_access_denied');
    expect(stored?.trigger_config.rules).toEqual(owner_rules);
    expect(stored?.trigger_status).toBe('enabled');
  });

  it('cannot be deleted by a member through the trigger route', async () => {
    const fixture = await create_fixture('member');

    const deleted = await send(fixture, 'DELETE', `/v1/triggers/${fixture.trigger.trigger_id}`);

    expect(deleted.status).toBe(403);
    expect(await get_trigger_by_id(fixture.db, fixture.trigger.trigger_id)).not.toBeNull();
  });

  it.each(['owner', 'admin'] as const)('can still be changed by the %s role', async (role) => {
    const fixture = await create_fixture(role);

    const renamed = await send(fixture, 'PATCH', `/v1/triggers/${fixture.trigger.trigger_id}`, {
      trigger_name: 'Renamed by an administrator',
    });

    expect(renamed.status).toBe(200);
  });

  it('leaves a member free to change and delete a task that belongs to no automation', async () => {
    const fixture = await create_fixture('member');
    const task_path = `/v1/triggers/${fixture.own_task.trigger_id}`;

    const renamed = await send(fixture, 'PATCH', task_path, { trigger_name: 'Renamed' });
    const deleted = await send(fixture, 'DELETE', task_path);

    expect(renamed.status).toBe(200);
    expect(deleted.status).toBe(200);
  });
});
