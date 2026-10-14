import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { describe, expect, it } from 'vitest';

const json = { 'Content-Type': 'application/json' };

async function app_with_project() {
  const db = await create_test_database();
  await bootstrap_default_workspace(db);
  const app = create_app(db);
  const created = await app.request('/v1/projects', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ project_name: 'Acme Support' }),
  });
  const body = await created.json();
  return { db, app, project_id: body.data.project_id as string };
}

describe('starting a chat inside a project', () => {
  it('stores the project on the session', async () => {
    const { app, project_id } = await app_with_project();

    const response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ session_title: 'Refund question', project_id }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.project_id).toBe(project_id);
  });

  it('puts a chat that names no project in the caller’s own room, not the named one', async () => {
    const { app, project_id } = await app_with_project();

    const response = await app.request('/v1/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ session_title: 'Just a chat' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.project_id).not.toBeNull();
    expect(body.data.project_id).not.toBe(project_id);
  });

  it('lists only that project’s chats when asked, and all of them when not', async () => {
    const { app, project_id } = await app_with_project();
    for (const [title, in_project] of [
      ['In the project', true],
      ['Also in the project', true],
      ['Outside it', false],
    ] as const) {
      await app.request('/v1/sessions', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ session_title: title, ...(in_project ? { project_id } : {}) }),
      });
    }

    const scoped = await (await app.request(`/v1/sessions?project_id=${project_id}`)).json();
    const everything = await (await app.request('/v1/sessions')).json();

    expect(scoped.data.map((s: { session_title: string }) => s.session_title).sort()).toEqual([
      'Also in the project',
      'In the project',
    ]);
    expect(everything.data.length).toBeGreaterThan(scoped.data.length);
  });

  it('does not leak another project’s chats', async () => {
    const { app, project_id } = await app_with_project();
    const other = await (
      await app.request('/v1/projects', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ project_name: 'Acme Internal' }),
      })
    ).json();

    await app.request('/v1/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ session_title: 'Secret', project_id: other.data.project_id }),
    });

    const scoped = await (await app.request(`/v1/sessions?project_id=${project_id}`)).json();
    expect(scoped.data).toEqual([]);
  });
});
