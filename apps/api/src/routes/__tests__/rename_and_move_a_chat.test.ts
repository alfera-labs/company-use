import { create_llm_gateway } from '@agent-core/llm_gateway';
import { create_fake_llm_adapter } from '@agent-core/llm_gateway/adapters/fake_llm_adapter';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_session_title_from_prompt } from '@runtime-platform/orchestrator/session_title';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;
type Answer = {
  status: number;
  data: {
    session_id: string;
    session_title: string | null;
    project_id: string | null;
    connections_lost?: string[];
  };
};

let db: Database;
let app: App;
let workspace_id: string;

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: (await response.json()).data };
}

async function open_chat(session_title?: string) {
  const created = await call('POST', '/v1/sessions', session_title ? { session_title } : {});
  return created.data.session_id;
}

beforeEach(async () => {
  db = await create_test_database();
  workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
  app = create_app(db);
});

describe('renaming a chat', () => {
  it('saves the name a person types, trimmed', async () => {
    const session_id = await open_chat('First name');

    const renamed = await call('PATCH', `/v1/sessions/${session_id}`, {
      session_title: '  Q3 pricing plan  ',
    });
    const read_back = await call('GET', `/v1/sessions/${session_id}`);

    expect(renamed.status).toBe(200);
    expect(renamed.data.session_title).toBe('Q3 pricing plan');
    expect(read_back.data.session_title).toBe('Q3 pricing plan');
  });

  it('keeps the typed name when the chat is named from its first message later', async () => {
    const session_id = await open_chat();
    await call('PATCH', `/v1/sessions/${session_id}`, { session_title: 'My own name' });

    const named = await set_session_title_from_prompt(db, {
      workspace_id,
      session_id,
      prompt_text: 'Debug the Stripe webhook failures today.',
      llm_gateway: create_llm_gateway({
        adapter: create_fake_llm_adapter('{"title":"Stripe Webhook Failure Debugging"}'),
        environment: { OPENAI_API_KEY: 'test-openai-key' },
      }),
    });

    expect(named).toEqual({ status: 'skipped', reason: 'custom_title' });
    expect((await call('GET', `/v1/sessions/${session_id}`)).data.session_title).toBe(
      'My own name',
    );
  });

  it.each([
    ['an empty name', { session_title: '   ' }],
    ['a name longer than 160 characters', { session_title: 'x'.repeat(161) }],
    ['a name and a project in one request', { session_title: 'Both', project_id: null }],
    ['a field it does not know', { title: 'Wrong field' }],
  ])('refuses %s', async (_what, body) => {
    const session_id = await open_chat('Unchanged');

    const refused = await call('PATCH', `/v1/sessions/${session_id}`, body);

    expect(refused.status).toBe(422);
    expect((await call('GET', `/v1/sessions/${session_id}`)).data.session_title).toBe('Unchanged');
  });
});

describe('moving a chat into a project', () => {
  it('moves the chat, keeps its name, and says what the move costs it', async () => {
    const session_id = await open_chat('Launch notes');
    const project = await app.request('/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_name: 'Launch' }),
    });
    const project_id = (await project.json()).data.project_id as string;

    const moved = await call('PATCH', `/v1/sessions/${session_id}`, { project_id });

    expect(moved.status).toBe(200);
    expect(moved.data.project_id).toBe(project_id);
    expect(moved.data.session_title).toBe('Launch notes');
    expect(moved.data.connections_lost).toEqual([]);
  });

  it('answers 404 for a project the person cannot see', async () => {
    const session_id = await open_chat('Stays put');

    const refused = await call('PATCH', `/v1/sessions/${session_id}`, {
      project_id: 'proj_does_not_exist',
    });

    expect(refused.status).toBe(404);
    expect((await call('GET', `/v1/sessions/${session_id}`)).data.project_id).not.toBe(
      'proj_does_not_exist',
    );
  });
});
