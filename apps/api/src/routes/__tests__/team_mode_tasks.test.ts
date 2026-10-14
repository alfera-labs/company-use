import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  task_names_listed_for,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { automation_lifecycle } from '@api/services/automations/automation_lifecycle';
import { build_participants } from '@coworker/core/access/build_participants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { create_run } from '@coworker/core/db/queries/sessions';
import { connections, resource_grants, runs, triggers } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { fire_due_schedule_triggers } from '@runtime-platform/events/schedule_trigger_loop';
import { open_scheduled_task_chat } from '@runtime-platform/events/scheduled_task_chat';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

type Team = Awaited<ReturnType<typeof team_of_three>>;

async function team_of_three() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Admin', 'owner');
  const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
  const ben = await invite_and_join(owner.user_id, 'Ben', 'member');
  await call('PATCH', `/v1/team/members/${admin.user_id}`, as_person(owner.user_id), {
    role: 'admin',
  });
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return {
    owner,
    admin,
    ada,
    ben,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
  };
}

async function task_of(team: Team, person: { user_id: string }, trigger_name: string) {
  const made = await call('POST', '/v1/triggers', as_person(person.user_id), {
    trigger_name,
    trigger_type: 'schedule',
    schedule_expression: '0 * * * *',
    trigger_config: { instruction: `Do the work of ${trigger_name}.`, timezone: 'UTC' },
  });
  expect(made.status).toBe(201);
  return { trigger_id: String(made.data.trigger_id), trigger_name, agent_id: team.agent_id };
}

const names_listed_for = (user_id: string) => task_names_listed_for(as_person(user_id));

async function status_of(trigger_id: string) {
  const [task] = await db.select().from(triggers).where(eq(triggers.trigger_id, trigger_id));
  return task?.trigger_status;
}

describe('whose scheduled tasks a person reaches through the API', () => {
  it('lists a member only the tasks they made, and an owner or an admin every task', async () => {
    const team = await team_of_three();
    await task_of(team, team.ada, 'Ada report');
    await task_of(team, team.ben, 'Ben report');

    expect(await names_listed_for(team.ada.user_id)).toEqual(['Ada report']);
    expect(await names_listed_for(team.ben.user_id)).toEqual(['Ben report']);
    expect(await names_listed_for(team.admin.user_id)).toEqual(['Ada report', 'Ben report']);
    expect(await names_listed_for(team.owner.user_id)).toEqual(['Ada report', 'Ben report']);
  });

  it('answers "not found" to a member who reads, changes, switches on, runs or deletes another member task', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const path = `/v1/triggers/${task.trigger_id}`;
    const as_ben = as_person(team.ben.user_id);

    const attempts = [
      await call('GET', `${path}/runs`, as_ben),
      await call('POST', `${path}/runs/read`, as_ben),
      await call('PATCH', path, as_ben, { trigger_name: 'Now it is Ben task' }),
      await call('PATCH', path, as_ben, { trigger_status: 'disabled' }),
      await call('POST', `${path}/run`, as_ben, { occurrence_key: 'now' }),
      await call('DELETE', path, as_ben),
    ];

    expect(attempts.map((attempt) => attempt.status)).toEqual(attempts.map(() => 404));
    const [untouched] = await db
      .select()
      .from(triggers)
      .where(eq(triggers.trigger_id, task.trigger_id));
    expect([untouched?.trigger_name, untouched?.trigger_status]).toEqual(['Ada report', 'enabled']);
  });

  it('lets the maker, an admin and an owner change a task', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const path = `/v1/triggers/${task.trigger_id}`;
    for (const person of [team.ada, team.admin, team.owner]) {
      const changed = await call('PATCH', path, as_person(person.user_id), {
        trigger_name: `Changed by ${person.user_id}`,
      });
      expect(changed.status).toBe(200);
    }
    expect((await call('GET', `${path}/runs`, as_person(team.ada.user_id))).status).toBe(200);
  });

  it('applies none of this outside team mode: every member reaches every task, as before', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const first = as_person('user_first_of_the_org');
    await call('GET', '/v1/workspace', first);
    const made = await call('POST', '/v1/triggers', first, {
      trigger_name: 'First person task',
      trigger_type: 'schedule',
      schedule_expression: '0 * * * *',
      trigger_config: { instruction: 'Work.', timezone: 'UTC' },
    });
    const second = as_person('user_second_of_the_org');
    expect(await names_listed_for('user_second_of_the_org')).toEqual([
      'Ada report',
      'First person task',
    ]);
    const changed = await call('PATCH', `/v1/triggers/${made.data.trigger_id}`, second, {
      trigger_name: 'Changed by the second person',
    });
    expect(changed.status).toBe(200);
    const also_changed = await call('PATCH', `/v1/triggers/${task.trigger_id}`, second, {
      trigger_name: 'Ada task, changed by the second person',
    });
    expect(also_changed.status).toBe(200);
  });
});

describe('whose scheduled tasks a coworker reaches through its own task tools', () => {
  const tools = automation_lifecycle;
  const acting_for = (team: Team, user_id: string) => ({
    workspace_id: team.workspace_id,
    agent_id: team.agent_id,
    actor_id: user_id,
  });

  const made_by_coworker_of = (team: Team, user_id: string, task_name: string) =>
    tools.create_scheduled_task(db, {
      ...acting_for(team, user_id),
      task_name,
      instruction: `Do the work of ${task_name}.`,
      schedule_expression: '0 * * * *',
    });

  it('lists a member coworker only that member tasks', async () => {
    const team = await team_of_three();
    await made_by_coworker_of(team, team.ada.user_id, 'Ada report');
    await made_by_coworker_of(team, team.ben.user_id, 'Ben report');
    const names = async (user_id: string) =>
      (await tools.list_scheduled_tasks(db, acting_for(team, user_id))).map((t) => t.trigger_name);

    expect(await names(team.ben.user_id)).toEqual(['Ben report']);
    expect((await names(team.admin.user_id)).sort()).toEqual(['Ada report', 'Ben report']);
    expect(await names('system:trigger')).toEqual([]);
  });

  it('does not let a member coworker change or delete another member task', async () => {
    const team = await team_of_three();
    const task = await made_by_coworker_of(team, team.ada.user_id, 'Ada report');
    const as_ben = { ...acting_for(team, team.ben.user_id), trigger_id: task.trigger_id };

    await expect(
      tools.update_scheduled_task(db, { ...as_ben, instruction: 'Send everything to Ben.' }),
    ).rejects.toThrow(/not found/u);
    await expect(tools.delete_scheduled_task(db, as_ben)).rejects.toThrow(/not found/u);
    expect(await status_of(task.trigger_id)).toBe('enabled');

    const as_ada = { ...acting_for(team, team.ada.user_id), trigger_id: task.trigger_id };
    const changed = await tools.update_scheduled_task(db, { ...as_ada, task_name: 'Ada weekly' });
    expect(changed.trigger_name).toBe('Ada weekly');
  });

  it('lets no run that no person started make a task, so no task is nobody task', async () => {
    const team = await team_of_three();
    await expect(
      tools.create_scheduled_task(db, {
        ...acting_for(team, 'system:trigger'),
        task_name: 'Made by a scheduled run',
        instruction: 'Work.',
        schedule_expression: '0 * * * *',
      }),
    ).rejects.toThrow(/Only a person on the team/u);
    const made = await tools.create_scheduled_task(db, {
      ...acting_for(team, team.ben.user_id),
      task_name: 'Made for Ben',
      instruction: 'Work.',
      schedule_expression: '0 * * * *',
    });
    expect(made.created_by).toBe(team.ben.user_id);
  });
});

describe('the chat and the reach of a scheduled task', () => {
  async function chat_of(
    team: Team,
    task: { trigger_id: string; trigger_name: string },
    maker: string,
  ) {
    return open_scheduled_task_chat(
      db,
      { ...task, workspace_id: team.workspace_id, agent_id: team.agent_id, created_by: maker },
      { trigger_id: task.trigger_id },
    );
  }

  it('keeps the chat of a task in its maker own room, where no other member reads it', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const chat = await chat_of(team, task, team.ada.user_id);
    const room = await find_personal_project(db, {
      workspace_id: team.workspace_id,
      user_id: team.ada.user_id,
    });

    expect(chat.project_id).toBe(room?.project_id);
    expect(
      (await call('GET', `/v1/sessions/${chat.session_id}`, as_person(team.ada.user_id))).status,
    ).toBe(200);
    expect(
      (await call('GET', `/v1/sessions/${chat.session_id}`, as_person(team.ben.user_id))).status,
    ).toBe(404);
  });

  it('gives a scheduled run no connection that is kept to named people, the maker own included', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const chat = await chat_of(team, task, team.ada.user_id);
    const audit = { created_by: team.owner.user_id, last_updated_by: team.owner.user_id };
    const connect = async (connection_id: string, only_for?: string) => {
      await db.insert(connections).values({
        connection_id,
        workspace_id: team.workspace_id,
        app_id: 'app_fixture',
        connection_key: connection_id,
        connection_status: 'active',
        connected_by: only_for ?? team.owner.user_id,
        ...audit,
      });
      if (!only_for) return;
      await db.insert(resource_grants).values({
        resource_grant_id: create_id(id_prefixes.resource_grant),
        workspace_id: team.workspace_id,
        resource_type: 'connection',
        resource_id: connection_id,
        grantee_type: 'user',
        grantee_id: only_for,
        grant_level: 'use',
        ...audit,
      });
    };
    await connect('conn_for_everyone');
    await connect('conn_only_ben', team.ben.user_id);
    await connect('conn_only_ada', team.ada.user_id);
    await connect('conn_only_admin', team.admin.user_id);
    const room = await find_personal_project(db, {
      workspace_id: team.workspace_id,
      user_id: team.ada.user_id,
    });
    const may_use = async (connection_id: string) => {
      const verdict = await check_resource_use(db, {
        workspace_id: team.workspace_id,
        resource_type: 'connection',
        resource_id: connection_id,
        participants: build_participants({
          project_id: chat.project_id,
          session_metadata: chat.session_metadata,
          session_source_metadata: chat.source_metadata,
          agent_ids: [chat.agent_id],
        }),
        owner_user_id: team.ada.user_id,
        room_private_to: room?.personal_for_user_id ?? null,
      });
      return verdict.allowed;
    };

    expect(await may_use('conn_for_everyone')).toBe(true);
    expect(await may_use('conn_only_ben')).toBe(false);
    expect(await may_use('conn_only_admin')).toBe(false);
    expect(await may_use('conn_only_ada')).toBe(false);
  });
});

describe('a task and the person who last changed it', () => {
  it('is switched off when that person is removed, and the remover is told', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const other = await task_of(team, team.ben, 'Ben report');
    await call('PATCH', `/v1/triggers/${task.trigger_id}`, as_person(team.admin.user_id), {
      trigger_config: { instruction: 'The admin wrote this.', timezone: 'UTC' },
    });

    const removed = await call(
      'DELETE',
      `/v1/team/members/${team.admin.user_id}`,
      as_person(team.owner.user_id),
    );

    expect(removed.data.scheduled_tasks_switched_off).toEqual(['Ada report']);
    expect(await status_of(task.trigger_id)).toBe('disabled');
    expect(await status_of(other.trigger_id)).toBe('enabled');
  });

  it('does not fire when someone switches it on again after that person left', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    await call('PATCH', `/v1/triggers/${task.trigger_id}`, as_person(team.admin.user_id), {
      trigger_name: 'Renamed by the admin',
    });
    await call('DELETE', `/v1/team/members/${team.admin.user_id}`, as_person(team.owner.user_id));
    await db
      .update(triggers)
      .set({ trigger_status: 'enabled' })
      .where(eq(triggers.trigger_id, task.trigger_id));

    await fire_due_schedule_triggers(db, new Date(Date.now() + 2 * 60 * 60 * 1000));

    expect(await status_of(task.trigger_id)).toBe('disabled');
  });
});

describe('a scheduled run of a person who is removed', () => {
  it('is stopped, though the scheduler started its chat and not the person', async () => {
    const team = await team_of_three();
    const task = await task_of(team, team.ada, 'Ada report');
    const chat = await open_scheduled_task_chat(
      db,
      { ...task, workspace_id: team.workspace_id, created_by: team.ada.user_id },
      { trigger_id: task.trigger_id },
    );
    const run = await create_run(db, {
      workspace_id: team.workspace_id,
      session_id: chat.session_id,
      agent_id: team.agent_id,
      trigger_type: 'schedule',
      trigger_id: task.trigger_id,
      actor_id: 'system:trigger',
    });
    expect(chat.created_by).toBe('system:trigger');

    const removed = await call(
      'DELETE',
      `/v1/team/members/${team.ada.user_id}`,
      as_person(team.owner.user_id),
    );

    expect(removed.data.runs_stopped).toBe(1);
    const [stopped] = await db.select().from(runs).where(eq(runs.run_id, run.run_id));
    expect(stopped?.run_status).toBe('cancelled');
  });
});
