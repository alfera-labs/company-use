import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { create_file } from '@coworker/core/db/queries/files';
import { create_project } from '@coworker/core/db/queries/projects';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { describe, expect, it } from 'vitest';

describe('project access routes', () => {
  it('hides private project sessions, runs, and files from another workspace member', async () => {
    const fixture = await create_fixture();
    const project = await create_project(fixture.db, {
      workspace_id: fixture.alice.workspace_id,
      project_name: 'Private room',
      owner_id: fixture.alice.user_id,
      actor_id: fixture.alice.user_id,
    });
    const session = await create_session(fixture.db, {
      workspace_id: fixture.alice.workspace_id,
      agent_id: fixture.alice.agent_id,
      project_id: project.project_id,
      actor_id: fixture.alice.user_id,
    });
    const run = await create_run(fixture.db, {
      workspace_id: fixture.alice.workspace_id,
      session_id: session.session_id,
      agent_id: fixture.alice.agent_id,
      trigger_type: 'user_message',
      actor_id: fixture.alice.user_id,
    });
    const file = await create_file(fixture.db, {
      workspace_id: fixture.alice.workspace_id,
      session_id: session.session_id,
      file_purpose: 'test',
      storage_provider: 'object_store',
      storage_key: `workspace/${fixture.alice.workspace_id}/files/test/private.txt`,
      actor_id: fixture.alice.user_id,
    });

    for (const path of [
      `/v1/projects/${project.project_id}`,
      `/v1/sessions/${session.session_id}`,
      `/v1/runs/${run.run_id}`,
      `/v1/files/${file.file_id}/download`,
    ]) {
      expect((await fixture.app.request(path, { headers: fixture.bob_headers })).status).toBe(404);
    }
    const start_hidden = await fixture.app.request('/v1/sessions', {
      method: 'POST',
      headers: json_headers(fixture.bob_headers),
      body: JSON.stringify({ project_id: project.project_id }),
    });
    expect(start_hidden.status).toBe(404);
  });

  it('leaves another member’s private chat out of the chat list', async () => {
    const fixture = await create_fixture();
    const created = await fixture.app.request('/v1/sessions', {
      method: 'POST',
      headers: json_headers(fixture.alice_headers),
      body: JSON.stringify({ session_title: 'Alice private notes' }),
    });
    const alice_chat_id = (await created.json()).data.session_id;
    const listed_ids = async (headers: Headers) => {
      const response = await fixture.app.request('/v1/sessions', { headers });
      return (await response.json()).data.map((row: { session_id: string }) => row.session_id);
    };

    expect(created.status).toBe(201);
    expect(await listed_ids(fixture.alice_headers)).toContain(alice_chat_id);
    expect(await listed_ids(fixture.bob_headers)).not.toContain(alice_chat_id);
  });

  it('shows the Workspace default and hides another person’s Personal default', async () => {
    const fixture = await create_fixture();
    const projects = await fixture.db.query.projects.findMany();
    const workspace = projects.find((project) => project.is_workspace_default);
    const personal = projects.find(
      (project) => project.personal_for_user_id === fixture.alice.user_id,
    );
    if (!workspace || !personal) throw new Error('Default projects missing');

    const bob_workspace_response = await fixture.app.request(
      `/v1/projects/${workspace.project_id}`,
      {
        headers: fixture.bob_headers,
      },
    );
    const alice_workspace_response = await fixture.app.request(
      `/v1/projects/${workspace.project_id}`,
      { headers: fixture.alice_headers },
    );
    expect(bob_workspace_response.status).toBe(200);
    expect((await bob_workspace_response.json()).data.can_manage).toBe(false);
    expect((await alice_workspace_response.json()).data.can_manage).toBe(true);
    expect(
      (
        await fixture.app.request(`/v1/projects/${personal.project_id}`, {
          headers: fixture.bob_headers,
        })
      ).status,
    ).toBe(404);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const alice = await provision(db, 'alice', 'alice@example.test');
  const bob = await provision(db, 'bob', 'bob@example.test');
  return {
    db,
    app: create_app(db),
    alice,
    bob,
    alice_headers: identity_headers('alice', 'alice@example.test'),
    bob_headers: identity_headers('bob', 'bob@example.test'),
  };
}

function json_headers(source: Headers) {
  const headers = new Headers(source);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function provision(db: Database, user: string, email: string) {
  return provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: user,
    organization_id: 'org_shared',
    organization_name: 'Shared workspace',
    email,
  });
}

function identity_headers(user: string, email: string) {
  const headers = new Headers([
    [proxy_auth_headers.secret, 'local-development-internal-api-secret'],
  ]);
  headers.set(proxy_auth_headers.provider_key, 'workos');
  headers.set(proxy_auth_headers.provider_user_id, user);
  headers.set(proxy_auth_headers.email, email);
  headers.set(proxy_auth_headers.organization_id, 'org_shared');
  return headers;
}
