import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_project } from '@coworker/core/db/queries/projects';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;
type Project = { project_id: string; name: string };

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(
  scopes: ApiKeyScope[] = ['projects.read', 'sessions.write'],
  key_audience: ApiKeyAudience = 'internal',
) {
  const { secret } = await create_api_key(db, {
    workspace_id,
    key_name: 'projects key',
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
  return secret;
}

async function call(secret: string, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as { data: never } };
}

async function room(project_name: string, project_access: 'members' | 'workspace') {
  return create_project(db, {
    workspace_id,
    project_name,
    project_access,
    actor_id,
    owner_id: actor_id,
  });
}

describe('public projects API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('lists only the rooms shared with the whole workspace, field by field', async () => {
    await room('Launch', 'workspace');
    await room('Board only', 'members');
    const secret = await mint_key();

    const listed = await call(secret, 'GET', '/v1/projects');
    const projects = listed.body.data as Project[];

    expect(listed.status).toBe(200);
    expect(projects.map((project) => project.name)).toContain('Launch');
    expect(projects.map((project) => project.name)).not.toContain('Board only');
    for (const project of projects) {
      expect(Object.keys(project).sort()).toEqual([
        'created_time',
        'description',
        'name',
        'project_id',
        'status',
      ]);
    }
  });

  it('files a session into a visible room and back out, and 404s a hidden one', async () => {
    const launch = await room('Launch', 'workspace');
    const hidden = await room('Board only', 'members');
    const secret = await mint_key();
    const created = await call(secret, 'POST', '/v1/sessions', {});
    const session_id = (created.body.data as { session_id: string }).session_id;
    const path = `/v1/sessions/${session_id}`;

    const filed = await call(secret, 'PATCH', path, { project_id: launch.project_id });
    const refused = await call(secret, 'PATCH', path, { project_id: hidden.project_id });
    const unfiled = await call(secret, 'PATCH', path, { project_id: null });

    expect(filed.status).toBe(200);
    expect(filed.body.data).toMatchObject({ project_id: launch.project_id, connections_lost: [] });
    expect(refused.status).toBe(404);
    expect(unfiled.body.data).toMatchObject({ project_id: null });
  });

  it('refuses to move a session another key opened', async () => {
    const launch = await room('Launch', 'workspace');
    const opener = await mint_key();
    const other = await mint_key();
    const created = await call(opener, 'POST', '/v1/sessions', {});
    const session_id = (created.body.data as { session_id: string }).session_id;

    const moved = await call(other, 'PATCH', `/v1/sessions/${session_id}`, {
      project_id: launch.project_id,
    });

    expect(moved.status).toBe(404);
  });

  it('refuses projects.read to an external key and to a key without it', async () => {
    expect((await call(await mint_key(['sessions.read']), 'GET', '/v1/projects')).status).toBe(403);
    expect(
      (await call(await mint_key(['projects.read'], 'external'), 'GET', '/v1/projects')).status,
    ).toBe(403);
  });
});
