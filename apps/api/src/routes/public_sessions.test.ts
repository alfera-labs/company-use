import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { mint_workspace_api_key } from '@api/services/api_keys';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  acquire_session_execution_lock,
  list_session_runs,
} from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine_calls = vi.hoisted(() => ({
  inputs: [] as { tool_names: string[]; conversation_text: string }[],
}));

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/sessions-test',
    async *run(input) {
      engine_calls.inputs.push({
        tool_names: input.tools.map((tool) => tool.tool_name),
        conversation_text: JSON.stringify(input.messages),
      });
      yield {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      };
    },
  }),
}));

vi.mock('@runtime-platform/model_resolver', () => ({
  resolve_model: () => ({ provider: 'openai', model_name: 'gpt-test', reasoning_level: 'medium' }),
}));

type App = ReturnType<typeof create_app>;
type PublicSession = {
  session_id: string;
  status: string;
  agent: { agent_id: string; slug: string; name: string };
  title: string | null;
  metadata: Record<string, string>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  created_time: string;
  last_activity_time: string;
  archived_time: string | null;
};
type SessionPage = { data: PublicSession[]; next_page: string | null; prev_page: string | null };

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(
  scopes: ApiKeyScope[] = ['sessions.write', 'sessions.read'],
  key_audience: ApiKeyAudience = 'internal',
): Promise<{ api_key: ApiKey; secret: string }> {
  return create_api_key(db, {
    workspace_id,
    key_name: `${key_audience} sessions key`,
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
}

function key_headers(secret: string, headers: Record<string, string> = {}) {
  return { authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...headers };
}

async function post_session(
  secret: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const response = await app.request('/v1/sessions', {
    method: 'POST',
    headers: key_headers(secret, headers),
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as { data?: PublicSession; error?: { code: string } },
  };
}

async function get_session(secret: string, session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}`, {
    headers: key_headers(secret),
  });
  return {
    status: response.status,
    body: (await response.json()) as { data?: PublicSession; error?: { code: string } },
  };
}

async function list_sessions(secret: string, query = '') {
  const response = await app.request(`/v1/sessions${query}`, { headers: key_headers(secret) });
  return {
    status: response.status,
    body: (await response.json()) as SessionPage & { error?: { code: string } },
  };
}

async function run_queued_session_jobs(session_id: string) {
  await run_queue_jobs(
    db,
    { workspace_id, queue_key: `session:${session_id}` },
    find_event_job_handler,
  );
}

describe('public sessions API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
    engine_calls.inputs.length = 0;
  });

  it('opens an idle session with the caller tags echoed back', async () => {
    const { secret } = await mint_key();

    const created = await post_session(secret, {
      title: 'Nightly report',
      metadata: { ticket: 'T-4812' },
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      status: 'idle',
      title: 'Nightly report',
      metadata: { ticket: 'T-4812' },
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      archived_time: null,
    });
    expect(created.body.data?.agent.slug).toBe('main');
    expect(Object.keys(created.body.data ?? {}).sort()).toEqual([
      'agent',
      'archived_time',
      'created_time',
      'last_activity_time',
      'metadata',
      'project_id',
      'session_id',
      'status',
      'title',
      'usage',
    ]);
  });

  it('names the agent that does not exist instead of opening a session anyway', async () => {
    const { secret } = await mint_key();

    const created = await post_session(secret, { agent: 'nobody' });

    expect(created.status).toBe(404);
  });

  it('refuses an initial event type v1 does not send', async () => {
    const { secret } = await mint_key();

    const created = await post_session(secret, {
      initial_events: [{ type: 'user.interrupt' }],
    });

    expect(created.status).toBe(422);
    expect(created.body.error?.code).toBe('validation_error');
  });

  it('runs the opening turn with the agent full tool surface', async () => {
    const { secret } = await mint_key();

    const created = await post_session(secret, {
      initial_events: [
        { type: 'user.message', content: [{ type: 'text', text: 'Summarize yesterday.' }] },
      ],
    });
    const session_id = created.body.data?.session_id ?? '';

    expect(created.status).toBe(201);
    expect(created.body.data?.status).toBe('running');

    await run_queued_session_jobs(session_id);

    const tool_names = engine_calls.inputs.at(0)?.tool_names ?? [];
    const registry_names = get_all_tools().map((tool) => tool.node_key);
    expect(registry_names).toContain('runtime-execute_tool-1');
    expect(tool_names).toContain('runtime-execute_tool-1');
    expect(engine_calls.inputs.at(0)?.conversation_text).toContain('Summarize yesterday.');
    expect(await list_session_runs(db, workspace_id, session_id)).toHaveLength(1);
    expect((await get_session(secret, session_id)).body.data?.status).toBe('idle');
  });

  it('hides a session from every key but the one that opened it', async () => {
    const { secret: owner_secret } = await mint_key();
    const { secret: other_secret } = await mint_key();
    const created = await post_session(owner_secret, { title: 'Private' });
    const session_id = created.body.data?.session_id ?? '';

    const read_by_other = await get_session(other_secret, session_id);
    const listed_by_other = await list_sessions(other_secret);

    expect(read_by_other.status).toBe(404);
    expect(read_by_other.body.error?.code).toBe('not_found');
    expect(listed_by_other.body.data).toEqual([]);
    expect((await list_sessions(owner_secret)).body.data).toHaveLength(1);
  });

  it('walks a list forward and back through opaque cursors', async () => {
    const { secret } = await mint_key();
    const first = await post_session(secret, { title: 'one' });
    const second = await post_session(secret, { title: 'two' });
    const third = await post_session(secret, { title: 'three' });
    const newest_first = [third, second, first].map((created) => created.body.data?.session_id);

    const page_one = await list_sessions(secret, '?limit=2');
    expect(page_one.body.data.map((session) => session.session_id)).toEqual(
      newest_first.slice(0, 2),
    );
    expect(page_one.body.next_page).toBeTruthy();

    const page_two = await list_sessions(
      secret,
      `?limit=2&page=${encodeURIComponent(page_one.body.next_page ?? '')}`,
    );
    expect(page_two.body.data.map((session) => session.session_id)).toEqual(newest_first.slice(2));
    expect(page_two.body.next_page).toBeNull();

    const back_again = await list_sessions(
      secret,
      `?limit=2&page=${encodeURIComponent(page_two.body.prev_page ?? '')}`,
    );
    expect(back_again.body.data.map((session) => session.session_id)).toEqual(
      newest_first.slice(0, 2),
    );
  });

  it('refuses a cursor issued under the other order', async () => {
    const { secret } = await mint_key();
    await post_session(secret, { title: 'one' });
    await post_session(secret, { title: 'two' });
    const page_one = await list_sessions(secret, '?limit=1');

    const reused = await list_sessions(
      secret,
      `?limit=1&order=asc&page=${encodeURIComponent(page_one.body.next_page ?? '')}`,
    );

    expect(reused.status).toBe(422);
  });

  it('replays a create under the same Idempotency-Key and refuses a changed one', async () => {
    const { secret } = await mint_key();
    const first = await post_session(secret, { title: 'Report' }, { 'idempotency-key': 'retry-1' });
    const replay = await post_session(
      secret,
      { title: 'Report' },
      { 'idempotency-key': 'retry-1' },
    );
    const changed = await post_session(
      secret,
      { title: 'Other' },
      { 'idempotency-key': 'retry-1' },
    );

    expect(replay.status).toBe(201);
    expect(replay.body.data?.session_id).toBe(first.body.data?.session_id);
    expect((await list_sessions(secret)).body.data).toHaveLength(1);
    expect(changed.status).toBe(409);
    expect(changed.body.error?.code).toBe('idempotency_key_reused');
  });

  it('refuses a changed create racing the first one under the same Idempotency-Key', async () => {
    const { secret } = await mint_key();
    const opening = (text: string) => ({
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
    });

    const raced = await Promise.all([
      post_session(secret, opening('Summarize yesterday.'), { 'idempotency-key': 'race-1' }),
      post_session(secret, opening('Delete everything.'), { 'idempotency-key': 'race-1' }),
    ]);

    expect(raced.map((result) => result.status).sort()).toEqual([201, 409]);
    const refused = raced.find((result) => result.status === 409);
    expect(refused?.body.error?.code).toBe('idempotency_key_reused');
    expect((await list_sessions(secret)).body.data).toHaveLength(1);
  });

  it('namespaces the Idempotency-Key per key, so one caller cannot claim another session', async () => {
    const { secret: first_secret } = await mint_key();
    const { secret: second_secret } = await mint_key();

    const mine = await post_session(first_secret, {}, { 'idempotency-key': 'ticket-9931' });
    const theirs = await post_session(second_secret, {}, { 'idempotency-key': 'ticket-9931' });

    expect(theirs.status).toBe(201);
    expect(theirs.body.data?.session_id).not.toBe(mine.body.data?.session_id);
  });

  it('archives an idle session and refuses to archive a running one', async () => {
    const { secret, api_key } = await mint_key();
    const created = await post_session(secret, {});
    const session_id = created.body.data?.session_id ?? '';

    await acquire_session_execution_lock(db, {
      workspace_id,
      session_id,
      run_id: 'run_locked',
      lease_ms: 60_000,
      actor_id: api_key.api_key_id,
    });
    const while_running = await app.request(`/v1/sessions/${session_id}/archive`, {
      method: 'POST',
      headers: key_headers(secret),
    });
    expect(while_running.status).toBe(409);
    expect(((await while_running.json()) as { error: { code: string } }).error.code).toBe(
      'conversation_busy',
    );

    const other = await post_session(secret, {});
    const archived = await app.request(`/v1/sessions/${other.body.data?.session_id}/archive`, {
      method: 'POST',
      headers: key_headers(secret),
    });
    const body = (await archived.json()) as { data: PublicSession };
    expect(archived.status).toBe(200);
    expect(body.data.status).toBe('terminated');
    expect(body.data.archived_time).not.toBeNull();
  });

  it('lets a sessions.write key read back what it opened, and never the reverse', async () => {
    const writer = await mint_key(['sessions.write']);
    const reader = await mint_key(['sessions.read']);

    const created = await post_session(writer.secret, {});
    const read_back = await get_session(writer.secret, created.body.data?.session_id ?? '');
    const listed = await list_sessions(writer.secret);
    const refused = await post_session(reader.secret, {});

    expect(created.status).toBe(201);
    expect(read_back.status).toBe(200);
    expect(listed.status).toBe(200);
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('scope_missing');
  });

  it('refuses sessions scopes on an external-audience key, at mint and at the request', async () => {
    await expect(
      mint_workspace_api_key(db, {
        workspace_id,
        user_id: actor_id,
        key_name: 'widget key',
        scopes: ['sessions.write'],
        key_audience: 'external',
      }),
    ).rejects.toMatchObject({ code: 'validation_error', status: 422 });

    const { secret } = await mint_key(['sessions.write', 'sessions.read'], 'external');
    const created = await post_session(secret, {});

    expect(created.status).toBe(403);
    expect(created.body.error?.code).toBe('scope_missing');
  });

  it('lets a request with no API key fall through to the dashboard route', async () => {
    const response = await app.request('/v1/sessions');
    const body = (await response.json()) as { data: unknown };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('keeps the answer conversations out of the sessions list', async () => {
    const { secret, api_key } = await mint_key();
    await create_answer_session(api_key);

    expect((await list_sessions(secret)).body.data).toEqual([]);
  });
});

async function create_answer_session(api_key: ApiKey) {
  const { find_agent_by_slug, find_or_create_session_for_external_thread } = await import(
    '@coworker/core/db/queries/sessions'
  );
  const agent = await find_agent_by_slug(db, workspace_id, 'main');
  return find_or_create_session_for_external_thread(db, {
    workspace_id,
    agent_id: agent?.agent_id ?? '',
    session_source: 'api',
    external_thread_key: `${api_key.api_key_id}:conversation-1`,
    source_metadata: { api_key_id: api_key.api_key_id },
    actor_id: api_key.api_key_id,
  });
}
