import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { require_upload_person_reads } from '@api/services/team/team_private_chats';
import { create_file } from '@coworker/core/db/queries/files';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import { keep_notifications_person_reads } from '@runtime-platform/tools/notification_readers';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

async function owner_with_a_private_chat_and_a_member() {
  const owner = await sign_the_owner_in();
  const member = await invite_and_join(owner.user_id, 'Ada', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  const chat = await call('POST', '/v1/sessions', as_person(owner.user_id), {});
  expect(chat.status).toBe(201);
  return {
    owner,
    member,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
    session_id: String(chat.data.session_id),
  };
}

type Team = Awaited<ReturnType<typeof owner_with_a_private_chat_and_a_member>>;

async function notification_written_in(team: Team, session_id: string | null, title: string) {
  const written = await record_notification_outcome(db, {
    workspace_id: team.workspace_id,
    subject: title,
    fingerprint: `fingerprint_${title}`,
    outcome: 'notify_now',
    actor_id: 'test',
    notification: {
      agent_id: team.agent_id,
      automation_id: null,
      run_id: 'run_test',
      session_id,
      principal_id: null,
      title,
      body: 'What the coworker found.',
      urgency: 'routine',
      score: 70,
      outcome_reason: 'Above the normal threshold.',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: { kind: 'none' },
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: {},
    },
  });
  return written?.event_id ?? '';
}

const notification_titles_schema = z.array(
  z.object({ notification: z.object({ title: z.string() }) }),
);

async function notification_titles_listed_for(user_id: string): Promise<string[]> {
  const listed = await call('GET', '/v1/notifications', as_person(user_id));
  expect(listed.status).toBe(200);
  const items = notification_titles_schema.parse(listed.data.items);
  return items.map((item) => item.notification.title).sort();
}

describe('what belongs to a private chat, reached by an id and not through the chat', () => {
  it('lists a notification written in a private chat only to the person who reads that chat', async () => {
    const team = await owner_with_a_private_chat_and_a_member();
    const private_one = await notification_written_in(team, team.session_id, 'Owner finding');
    await notification_written_in(team, null, 'For the workspace');

    expect(await notification_titles_listed_for(team.owner.user_id)).toEqual([
      'For the workspace',
      'Owner finding',
    ]);
    expect(await notification_titles_listed_for(team.member.user_id)).toEqual([
      'For the workspace',
    ]);
    const dismiss = `/v1/notifications/${private_one}/dismiss`;
    expect((await call('POST', dismiss, as_person(team.member.user_id))).status).toBe(404);
    expect((await call('POST', dismiss, as_person(team.owner.user_id))).status).toBe(200);
  });

  it('lists every notification to every member outside team mode, as before', async () => {
    const team = await owner_with_a_private_chat_and_a_member();
    await notification_written_in(team, team.session_id, 'Owner finding');
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const one = { notification: { session_id: team.session_id } };
    const reader = { workspace_id: team.workspace_id, user_id: team.member.user_id };

    expect(await keep_notifications_person_reads(db, reader, [one])).toEqual([one]);
  });

  it('answers "not found" to a member who asks for the open question of another person chat', async () => {
    const team = await owner_with_a_private_chat_and_a_member();
    const path = `/v1/choices/open?session_id=${team.session_id}`;

    expect((await call('GET', path, as_person(team.member.user_id))).status).toBe(404);
    expect((await call('GET', path, as_person(team.owner.user_id))).status).toBe(200);
  });

  it('lets only a person who reads a chat copy an upload of that chat elsewhere', async () => {
    const team = await owner_with_a_private_chat_and_a_member();
    const file = await create_file(db, {
      workspace_id: team.workspace_id,
      session_id: team.session_id,
      file_purpose: 'attachment',
      storage_provider: 'local',
      storage_key: 'a/key',
      actor_id: team.owner.user_id,
    });
    const as_reader = (user_id: string) =>
      require_upload_person_reads(db, { workspace_id: team.workspace_id, user_id }, file.file_id);

    await expect(as_reader(team.member.user_id)).rejects.toThrow('Session was not found');
    await expect(as_reader(team.owner.user_id)).resolves.toBeUndefined();
  });
});
