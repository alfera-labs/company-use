import { beforeAll, describe, expect, it } from 'vitest';

export type ApiApp = { request: (path: string, init?: RequestInit) => Promise<Response> };
export type PersonHeaders = Record<string, string>;
export type TwoPeople = {
  app: ApiApp;
  owner: PersonHeaders;
  teammate: PersonHeaders;
  teammate_user_id: string;
  stranger?: PersonHeaders;
};

/**
 * The path two people of one workspace walk: a room, its chats, who sees what, and the door
 * closing again. It runs for people the sign-in provider names and for people of team mode, so
 * both kinds of person get the same walls.
 */
export function describe_two_people_sharing_a_room(title: string, meet: () => Promise<TwoPeople>) {
  describe(title, () => {
    let app: ApiApp;
    let owner: PersonHeaders;
    let teammate: PersonHeaders;
    let stranger: PersonHeaders | undefined;
    let teammate_user_id: string;
    let project_id: string;
    let owner_chat_id: string;

    async function get_data(headers: PersonHeaders, path: string) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(200);
      return (await response.json()).data;
    }

    async function post(headers: PersonHeaders, path: string, body: unknown) {
      return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
    }

    beforeAll(async () => {
      ({ app, owner, teammate, stranger, teammate_user_id } = await meet());
    }, 30_000);

    it('the owner makes a room and starts a chat in it', async () => {
      const created = await post(owner, '/v1/projects', { project_name: 'marketing' });
      expect(created.status).toBe(201);
      project_id = (await created.json()).data.project_id;

      const chat = await post(owner, '/v1/sessions', { project_id, session_title: 'Fall promo' });
      expect(chat.status).toBe(201);
      owner_chat_id = (await chat.json()).data.session_id;
    });

    it('a teammate in the same workspace cannot see the room or its chat', async () => {
      const projects = await get_data(teammate, '/v1/projects');
      expect(projects.some((row: { project_id: string }) => row.project_id === project_id)).toBe(
        false,
      );

      const sessions = await get_data(teammate, '/v1/sessions');
      expect(sessions.some((row: { session_id: string }) => row.session_id === owner_chat_id)).toBe(
        false,
      );
    });

    it('tells the teammate the truth when their new room clashes with one they cannot see', async () => {
      const clashed = await post(teammate, '/v1/projects', { project_name: 'marketing' });
      expect(clashed.status).toBe(409);
      const body = await clashed.json();
      expect(body.error.message).toContain('not a member');
    });

    it('the owner adds the teammate, and the door opens', async () => {
      const added = await app.request(`/v1/projects/${project_id}/members`, {
        method: 'PUT',
        headers: owner,
        body: JSON.stringify({
          grantee_type: 'user',
          grantee_id: teammate_user_id,
          grant_level: 'use',
        }),
      });
      expect(added.status).toBe(200);

      const projects = await get_data(teammate, '/v1/projects');
      expect(projects.some((row: { project_id: string }) => row.project_id === project_id)).toBe(
        true,
      );
      const sessions = await get_data(teammate, '/v1/sessions');
      expect(sessions.some((row: { session_id: string }) => row.session_id === owner_chat_id)).toBe(
        true,
      );
    });

    it('the teammate starts their own chat in the shared room, and the owner sees it', async () => {
      const chat = await post(teammate, '/v1/sessions', { project_id, session_title: 'My reply' });
      expect(chat.status).toBe(201);
      const teammate_chat_id = (await chat.json()).data.session_id;

      const sessions = await get_data(owner, '/v1/sessions');
      expect(
        sessions.some((row: { session_id: string }) => row.session_id === teammate_chat_id),
      ).toBe(true);
    });

    it('personal chats never cross between teammates', async () => {
      const personal = await post(owner, '/v1/sessions', { session_title: 'Owner private notes' });
      const personal_id = (await personal.json()).data.session_id;

      const sessions = await get_data(teammate, '/v1/sessions');
      expect(sessions.some((row: { session_id: string }) => row.session_id === personal_id)).toBe(
        false,
      );
    });

    it('a stranger from another workspace sees nothing and clashes with nothing', async () => {
      if (!stranger) return;
      const projects = await get_data(stranger, '/v1/projects');
      expect(projects.some((row: { project_id: string }) => row.project_id === project_id)).toBe(
        false,
      );

      const created = await post(stranger, '/v1/projects', { project_name: 'marketing' });
      expect(created.status).toBe(201);
    });

    it('a roomless chat moves into the room, and the room now governs it', async () => {
      const old_chat = await post(owner, '/v1/sessions', { session_title: 'Old customer chat' });
      const old_chat_id = (await old_chat.json()).data.session_id;
      await app.request(`/v1/sessions/${old_chat_id}`, {
        method: 'PATCH',
        headers: owner,
        body: JSON.stringify({ project_id: null }),
      });

      const moved = await app.request(`/v1/sessions/${old_chat_id}`, {
        method: 'PATCH',
        headers: owner,
        body: JSON.stringify({ project_id, share_with_its_readers: true }),
      });
      expect(moved.status).toBe(200);
      expect((await moved.json()).data.project_id).toBe(project_id);

      const sessions = await get_data(teammate, '/v1/sessions');
      expect(sessions.some((row: { session_id: string }) => row.session_id === old_chat_id)).toBe(
        true,
      );
    });

    it('a chat cannot be moved into a room the mover cannot see', async () => {
      const chat = await post(teammate, '/v1/sessions', { session_title: 'Teammate notes' });
      const chat_id = (await chat.json()).data.session_id;
      const owner_projects = await get_data(owner, '/v1/projects');
      const owner_personal = owner_projects.find(
        (row: { personal_for_user_id: string | null }) => row.personal_for_user_id !== null,
      );

      const refused = await app.request(`/v1/sessions/${chat_id}`, {
        method: 'PATCH',
        headers: teammate,
        body: JSON.stringify({ project_id: owner_personal.project_id }),
      });
      expect(refused.status).toBe(404);
    });

    it('removing the teammate closes the door again', async () => {
      const removed = await app.request(
        `/v1/projects/${project_id}/members/user/${teammate_user_id}`,
        { method: 'DELETE', headers: owner },
      );
      expect(removed.status).toBe(204);

      const projects = await get_data(teammate, '/v1/projects');
      expect(projects.some((row: { project_id: string }) => row.project_id === project_id)).toBe(
        false,
      );
      const sessions = await get_data(teammate, '/v1/sessions');
      expect(sessions.some((row: { session_id: string }) => row.session_id === owner_chat_id)).toBe(
        false,
      );
    });
  });
}
