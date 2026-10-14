import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { automation_lifecycle } from '@api/services/automations/automation_lifecycle';
import { describe, expect, it } from 'vitest';

use_a_fresh_team_install();

const set_timezone = (user_id: string, body: unknown) =>
  call('PUT', '/v1/me/timezone', as_person(user_id), body);

const timezone_of = async (user_id: string) =>
  (await call('GET', '/v1/me/timezone', as_person(user_id))).data.timezone;

describe('the time zone of a person on a team install', () => {
  it('is set and read by that person only, whatever a member sends', async () => {
    const owner = await sign_the_owner_in();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    expect((await set_timezone(owner.user_id, { timezone: 'Europe/Rome' })).status).toBe(200);

    const set_for_another = { timezone: 'Asia/Tokyo', user_id: owner.user_id };
    expect((await set_timezone(ada.user_id, set_for_another)).status).toBe(422);
    expect((await set_timezone(ada.user_id, { timezone: 'Asia/Tokyo' })).status).toBe(200);

    expect(await timezone_of(owner.user_id)).toBe('Europe/Rome');
    expect(await timezone_of(ada.user_id)).toBe('Asia/Tokyo');
    expect((await set_timezone('user_of_nobody', { timezone: 'UTC' })).status).toBe(401);
  });

  it('runs a task the coworker makes for a member in the time zone of that member', async () => {
    const owner = await sign_the_owner_in();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    await set_timezone(owner.user_id, { timezone: 'Europe/Rome' });
    await set_timezone(ada.user_id, { timezone: 'Asia/Tokyo' });
    const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));

    const task = await automation_lifecycle.create_scheduled_task(db, {
      workspace_id: String(workspace.data.workspace_id),
      agent_id: await main_agent_id(as_person(owner.user_id)),
      task_name: 'Morning plan',
      instruction: 'Write the plan for the day.',
      schedule_expression: '0 9 * * 1-5',
      actor_id: ada.user_id,
    });

    expect(task.created_by).toBe(ada.user_id);
    expect(task.trigger_config.timezone).toBe('Asia/Tokyo');
  });
});
