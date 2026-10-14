import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { create_run } from '@coworker/core/db/queries/sessions';
import { create_trigger, update_trigger_status } from '@coworker/core/db/queries/trigger_writes';
import { events, runs, triggers } from '@coworker/core/db/schema';
import { fire_due_schedule_triggers } from '@runtime-platform/events/schedule_trigger_loop';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

const with_key = (secret: string) => ({ authorization: `Bearer ${secret}` });
const hour = (clock_hour: number) => new Date(`2026-09-28T${clock_hour}:00:00.000Z`);

async function team_of_two() {
  const owner = await sign_the_owner_in();
  const member = await invite_and_join(owner.user_id, 'Lin', 'admin');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return {
    owner,
    member,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
  };
}

async function hourly_task_of(team: Awaited<ReturnType<typeof team_of_two>>, user_id: string) {
  return create_trigger(db, {
    workspace_id: team.workspace_id,
    agent_id: team.agent_id,
    trigger_name: `Hourly report of ${user_id}`,
    trigger_type: 'schedule',
    schedule_expression: '0 * * * *',
    trigger_config: { starts_job_handler: 'daily_digest', timezone: 'UTC' },
    actor_id: user_id,
  });
}

async function fires_of(trigger_id: string) {
  const fires = await db.query.events.findMany({
    where: like(events.source_event_id, `${trigger_id}:%`),
  });
  return fires.length;
}

async function status_of(trigger_id: string) {
  const [trigger] = await db.select().from(triggers).where(eq(triggers.trigger_id, trigger_id));
  return trigger?.trigger_status;
}

const remove = (team: Awaited<ReturnType<typeof team_of_two>>) =>
  call('DELETE', `/v1/team/members/${team.member.user_id}`, as_person(team.owner.user_id));

describe('removing a person from the team', () => {
  it('ends what works for them with nobody signed in: their key answers 401 and their task does not fire', async () => {
    const team = await team_of_two();
    const make_key = (actor_id: string) =>
      create_api_key(db, {
        workspace_id: team.workspace_id,
        key_name: `key of ${actor_id}`,
        scopes: ['sessions.read'],
        key_audience: 'internal',
        environment_label: 'test',
        actor_id,
      });
    const [member_key, owner_key] = [
      await make_key(team.member.user_id),
      await make_key(team.owner.user_id),
    ];
    const member_task = await hourly_task_of(team, team.member.user_id);
    const owner_task = await hourly_task_of(team, team.owner.user_id);
    await fire_due_schedule_triggers(db, new Date('2026-09-28T10:30:00.000Z'));
    await fire_due_schedule_triggers(db, hour(11));
    expect([await fires_of(member_task.trigger_id), await fires_of(owner_task.trigger_id)]).toEqual(
      [1, 1],
    );
    expect((await call('GET', '/v1/me', with_key(member_key.secret))).status).toBe(200);

    const removed = await remove(team);

    expect(removed.data).toMatchObject({
      api_keys_revoked: 1,
      scheduled_tasks_switched_off: [member_task.trigger_name],
    });
    const refused = await call('GET', '/v1/me', with_key(member_key.secret));
    expect([refused.status, refused.error?.code]).toEqual([401, 'api_key_revoked']);
    expect((await call('GET', '/v1/me', with_key(owner_key.secret))).status).toBe(200);

    await fire_due_schedule_triggers(db, hour(12));
    expect(await status_of(member_task.trigger_id)).toBe('disabled');
    expect([await fires_of(member_task.trigger_id), await fires_of(owner_task.trigger_id)]).toEqual(
      [1, 2],
    );
  });

  it('keeps a task of a person who is out from firing even when it is switched on again', async () => {
    const team = await team_of_two();
    const member_task = await hourly_task_of(team, team.member.user_id);
    await fire_due_schedule_triggers(db, new Date('2026-09-28T10:30:00.000Z'));
    await remove(team);
    await update_trigger_status(db, {
      workspace_id: team.workspace_id,
      trigger_id: member_task.trigger_id,
      trigger_status: 'enabled',
      actor_id: 'somebody_with_the_database',
    });

    await fire_due_schedule_triggers(db, hour(11));

    expect(await fires_of(member_task.trigger_id)).toBe(0);
    expect(await status_of(member_task.trigger_id)).toBe('disabled');
  });

  it('leaves the scheduler outside team mode as it was: no membership question is asked', async () => {
    const team = await team_of_two();
    const member_task = await hourly_task_of(team, team.member.user_id);
    await fire_due_schedule_triggers(db, new Date('2026-09-28T10:30:00.000Z'));
    await remove(team);
    await update_trigger_status(db, {
      workspace_id: team.workspace_id,
      trigger_id: member_task.trigger_id,
      trigger_status: 'enabled',
      actor_id: 'somebody_with_the_database',
    });
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    await fire_due_schedule_triggers(db, hour(11));

    expect(await fires_of(member_task.trigger_id)).toBe(1);
  });

  it('stops the runs still going in the chats of that person', async () => {
    const team = await team_of_two();
    const chat = await call('POST', '/v1/sessions', as_person(team.member.user_id), {
      session_title: 'Long job',
    });
    const run = await create_run(db, {
      workspace_id: team.workspace_id,
      session_id: String(chat.data.session_id),
      agent_id: team.agent_id,
      trigger_type: 'user_message',
      actor_id: team.member.user_id,
    });

    const removed = await remove(team);

    expect(removed.data.runs_stopped).toBe(1);
    const [stopped] = await db.select().from(runs).where(eq(runs.run_id, run.run_id));
    expect(stopped?.run_status).toBe('cancelled');
  });
});
