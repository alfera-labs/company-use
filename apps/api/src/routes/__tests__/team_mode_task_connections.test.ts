import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { build_run_participants } from '@coworker/core/access/build_participants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { record_known_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import { connections, resource_grants } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { open_scheduled_task_chat } from '@runtime-platform/events/scheduled_task_chat';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

async function task_chat_of_a_member_with_a_private_connection() {
  const owner = await sign_the_owner_in();
  const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  const workspace_id = String(workspace.data.workspace_id);
  const agent_id = await main_agent_id(as_person(owner.user_id));
  const chat = await open_scheduled_task_chat(
    db,
    {
      workspace_id,
      agent_id,
      trigger_id: 'trg_ada',
      trigger_name: 'Ada report',
      created_by: ada.user_id,
    },
    {},
  );
  const audit = { created_by: ada.user_id, last_updated_by: ada.user_id };
  await db.insert(connections).values({
    connection_id: 'conn_only_ada',
    workspace_id,
    app_id: 'app_fixture',
    connection_key: 'conn_only_ada',
    connection_status: 'active',
    connected_by: ada.user_id,
    ...audit,
  });
  await db.insert(resource_grants).values({
    resource_grant_id: create_id(id_prefixes.resource_grant),
    workspace_id,
    resource_type: 'connection',
    resource_id: 'conn_only_ada',
    grantee_type: 'user',
    grantee_id: ada.user_id,
    grant_level: 'use',
    ...audit,
  });
  return { ada, workspace_id, chat };
}

describe('the private connection of the person who made a scheduled task', () => {
  it('is refused to every scheduled run, also after that person wrote in the task chat', async () => {
    const { ada, workspace_id, chat } = await task_chat_of_a_member_with_a_private_connection();
    const may_use = async (session: typeof chat, trigger_type: string) => {
      const verdict = await check_resource_use(db, {
        workspace_id,
        resource_type: 'connection',
        resource_id: 'conn_only_ada',
        participants: build_run_participants(session, trigger_type),
        owner_user_id: ada.user_id,
        room_private_to: ada.user_id,
      });
      return verdict.allowed;
    };
    expect(await may_use(chat, 'schedule')).toBe(false);

    const spoken = await record_known_user_as_speaker(db, {
      workspace_id,
      session_id: chat.session_id,
      user_id: ada.user_id,
      user: undefined,
    });

    expect(build_run_participants(spoken.session, 'user_message').user).toEqual([ada.user_id]);
    expect(await may_use(spoken.session, 'schedule')).toBe(false);
    expect(await may_use(spoken.session, 'user_message')).toBe(true);
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(await may_use(spoken.session, 'schedule')).toBe(true);
  });
});
