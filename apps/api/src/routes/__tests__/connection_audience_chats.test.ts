import {
  type Bigco,
  build_bigco,
  connection_ids,
} from '@api/routes/__tests__/connection_audience_bigco';
import { read_data } from '@api/routes/__tests__/connection_audience_org';
import { build_participants } from '@coworker/core/access/build_participants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { find_project } from '@coworker/core/db/queries/projects';
import { record_platform_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import { get_session } from '@coworker/core/db/queries/sessions';
import { beforeAll, describe, expect, it } from 'vitest';

const { github, gmail_hr, notion } = connection_ids;

let org: Bigco;

beforeAll(async () => {
  org = await build_bigco();
}, 240_000);

function ask(connection_id: string, gathering: Gathering) {
  return check_resource_use(org.db, {
    workspace_id: org.workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    participants: gathering.participants,
    owner_user_id: org.admin.user_id,
    room_private_to: gathering.room_private_to,
  });
}

type Gathering = { participants: Participants; room_private_to: string | null };

async function participants_of(session_id: string): Promise<Gathering> {
  const session = await get_session(org.db, org.workspace_id, session_id);
  if (!session) throw new Error(`session ${session_id} vanished`);
  const project = session.project_id
    ? await find_project(org.db, {
        workspace_id: org.workspace_id,
        project_id: session.project_id,
      })
    : null;
  return {
    participants: build_participants({
      project_id: session.project_id,
      session_metadata: session.session_metadata,
      session_source_metadata: session.source_metadata,
      agent_ids: [session.agent_id],
    }),
    room_private_to: project?.personal_for_user_id ?? null,
  };
}

function speaks(session_id: string, person: { user_id: string }) {
  return record_platform_user_as_speaker(org.db, {
    workspace_id: org.workspace_id,
    session_id,
    user_id: person.user_id,
  });
}

describe('connection reach follows the real people in a real chat', () => {
  it('opens the HR connection in an HR chat and keeps the engineering one shut', async () => {
    const hr_1 = org.people.hr_1 as { user_id: string; headers: Record<string, string> };
    const chat = await read_data(org.app, hr_1.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.hr,
      session_title: 'Offer letters',
    });
    await speaks(chat.session_id, hr_1);

    const gathering = await participants_of(chat.session_id);
    expect(gathering.participants.project).toEqual([org.rooms.hr]);
    expect(gathering.participants.user).toEqual([hr_1.user_id]);
    expect((await ask(gmail_hr, gathering)).allowed).toBe(true);
    expect((await ask(github, gathering)).allowed).toBe(false);
  });

  it('keeps reach a property of the room, not of who happens to be typing', async () => {
    const hr_1 = org.people.hr_1 as { user_id: string; headers: Record<string, string> };
    const legal_3 = org.people.legal_3 as { user_id: string };
    const chat = await read_data(org.app, hr_1.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.hr,
      session_title: 'Headcount',
    });
    await speaks(chat.session_id, hr_1);
    await speaks(chat.session_id, legal_3);

    expect((await ask(gmail_hr, await participants_of(chat.session_id))).allowed).toBe(true);
  });

  it('drops a chat that is moved out of its room to the unrestricted connections only', async () => {
    const eng_1 = org.people.eng_1 as { user_id: string; headers: Record<string, string> };
    const chat = await read_data(org.app, eng_1.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.search,
      session_title: 'Ranking spike',
    });
    await speaks(chat.session_id, eng_1);
    expect((await ask(github, await participants_of(chat.session_id))).allowed).toBe(true);

    const moved = await read_data(
      org.app,
      eng_1.headers,
      'PATCH',
      `/v1/sessions/${chat.session_id}`,
      { project_id: null },
    );
    const after_move = await participants_of(chat.session_id);
    expect(after_move.participants.project).toEqual([]);
    expect(await ask(github, after_move)).toMatchObject({
      allowed: false,
      denial_reason: 'nobody_present_to_check',
    });
    expect(moved.connections_lost).toEqual(['GitHub org']);
  });

  it('names only what the move actually costs, not everything the old room reached', async () => {
    const eng_3 = org.people.eng_3 as { user_id: string; headers: Record<string, string> };
    const chat = await read_data(org.app, eng_3.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.search,
      session_title: 'Index rebuild',
    });
    await speaks(chat.session_id, eng_3);

    const moved = await read_data(
      org.app,
      eng_3.headers,
      'PATCH',
      `/v1/sessions/${chat.session_id}`,
      { project_id: org.rooms.cloud },
    );
    expect(moved.project_id).toBe(org.rooms.cloud);
    expect(moved.connections_lost).toEqual([]);
  });

  it('names the room-scoped connection lost when a chat moves between departments', async () => {
    const legal_3 = org.people.legal_3 as { user_id: string; headers: Record<string, string> };
    const chat = await read_data(org.app, legal_3.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.hr,
      session_title: 'Comp review',
    });
    await speaks(chat.session_id, legal_3);

    const moved = await read_data(
      org.app,
      legal_3.headers,
      'PATCH',
      `/v1/sessions/${chat.session_id}`,
      { project_id: org.rooms.legal },
    );
    expect(moved.connections_lost).toEqual(['Gmail (people ops)']);
  });

  it('costs the owner the room-scoped mailbox too, when the room is one other people read', async () => {
    const chat = await read_data(org.app, org.admin.headers, 'POST', '/v1/sessions', {
      project_id: org.rooms.hr,
      session_title: 'Comp review, owner solo',
    });
    await speaks(chat.session_id, org.admin);

    const moved = await read_data(
      org.app,
      org.admin.headers,
      'PATCH',
      `/v1/sessions/${chat.session_id}`,
      { project_id: org.rooms.legal },
    );
    expect(moved.connections_lost).toEqual(['Gmail (people ops)']);
  });

  it('keeps every connection the owner made when the chat is in the owner’s own room', async () => {
    const chat = await read_data(org.app, org.admin.headers, 'POST', '/v1/sessions', {
      project_id: org.admin_personal_room,
      session_title: 'Ada thinking out loud',
    });
    await speaks(chat.session_id, org.admin);

    const gathering = await participants_of(chat.session_id);
    expect(gathering.room_private_to).toBe(org.admin.user_id);
    expect((await ask(github, gathering)).allowed).toBe(true);
    expect((await ask(gmail_hr, gathering)).allowed).toBe(true);
    expect((await ask(notion, gathering)).allowed).toBe(true);

    const moved = await read_data(
      org.app,
      org.admin.headers,
      'PATCH',
      `/v1/sessions/${chat.session_id}`,
      { project_id: org.rooms.legal },
    );
    expect([...moved.connections_lost].sort()).toEqual(['GitHub org', 'Gmail (people ops)'].sort());
  });

  it('keeps a personal chat out of every department connection', async () => {
    const eng_1 = org.people.eng_1 as { user_id: string; headers: Record<string, string> };
    const chat = await read_data(org.app, eng_1.headers, 'POST', '/v1/sessions', {
      session_title: 'Scratch',
    });
    await speaks(chat.session_id, eng_1);
    const gathering = await participants_of(chat.session_id);

    expect((await ask(github, gathering)).allowed).toBe(false);
    expect((await ask(notion, gathering)).allowed).toBe(true);
  });
});
