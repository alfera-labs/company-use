import type { RuntimeAgentEngine } from '@agent-core/runs';
import { create_app } from '@api/app';
import { api_key_rate_window_ms, api_key_requests_per_window } from '@api/lib/api_key_auth';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKey,
  type ApiKeyScope,
  count_api_key_request_in_window,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_file } from '@coworker/core/db/queries/files';
import { list_session_runs } from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import {
  create_in_memory_object_storage,
  generate_file_object_key,
  set_memory_import_object_storage_for_tests,
} from '@coworker/runtime-platform';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@agent-core/engines/pi', () => ({
  create_pi_engine: (): RuntimeAgentEngine => ({
    engine_name: 'agent-core/pi/session-files-test',
    async *run() {
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
type PublicSessionFile = {
  file_id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_time: string;
};

const report_bytes = new TextEncoder().encode('payout,amount\nnorthwind,4200\n');

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;
let storage: ReturnType<typeof create_in_memory_object_storage>;

async function mint_key(
  scopes: ApiKeyScope[] = ['sessions.write', 'sessions.read'],
): Promise<{ api_key: ApiKey; secret: string }> {
  return create_api_key(db, {
    workspace_id,
    key_name: 'sessions files key',
    scopes,
    key_audience: 'internal',
    environment_label: 'test',
    actor_id,
  });
}

function key_headers(secret: string) {
  return { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

async function run_a_turn(secret: string) {
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: key_headers(secret),
    body: JSON.stringify({
      initial_events: [
        { type: 'user.message', content: [{ type: 'text', text: 'Write the payout report.' }] },
      ],
    }),
  });
  const session_id =
    ((await created.json()) as { data?: { session_id: string } }).data?.session_id ?? '';
  await run_queue_jobs(
    db,
    { workspace_id, queue_key: `session:${session_id}` },
    find_event_job_handler,
  );
  return session_id;
}

async function write_a_file(session_id: string, file_name: string) {
  const [run] = await list_session_runs(db, workspace_id, session_id);
  if (!run) throw new Error('the session has no run');
  const object_key = generate_file_object_key({
    workspace_id,
    file_id: `file_${file_name}`,
    file_name,
  });
  await storage.put_if_absent({
    object_key,
    data: report_bytes,
    content_type: 'text/csv',
  });
  return create_file(db, {
    workspace_id,
    session_id,
    run_id: run.run_id,
    file_purpose: 'output',
    storage_provider: 'object_store',
    storage_key: object_key,
    file_name,
    mime_type: 'text/csv',
    byte_size: report_bytes.byteLength,
    actor_id,
  });
}

async function list_files(secret: string, session_id: string) {
  const response = await app.request(`/v1/sessions/${session_id}/files`, {
    headers: key_headers(secret),
  });
  return {
    status: response.status,
    body: (await response.json()) as { data?: PublicSessionFile[]; error?: { code: string } },
  };
}

describe('public session files API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
    storage = create_in_memory_object_storage();
    set_memory_import_object_storage_for_tests(storage);
  });

  afterEach(() => {
    set_memory_import_object_storage_for_tests(undefined);
  });

  it('lists what every run of the session produced, in the frozen shape', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret);
    const file = await write_a_file(session_id, 'payouts.csv');

    const listed = await list_files(secret, session_id);

    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        file_id: file.file_id,
        filename: 'payouts.csv',
        mime_type: 'text/csv',
        size_bytes: report_bytes.byteLength,
        created_time: file.created_time.toISOString(),
      },
    ]);
  });

  it('hands the owner the bytes and names them', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret);
    const file = await write_a_file(session_id, 'payouts.csv');

    const downloaded = await app.request(`/v1/files/${file.file_id}/content`, {
      headers: key_headers(secret),
    });

    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('text/csv');
    expect(downloaded.headers.get('content-disposition')).toBe(
      'attachment; filename="payouts.csv"',
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(report_bytes);
  });

  it('refuses another key the file and the list, as not_found', async () => {
    const { secret: owner_secret } = await mint_key();
    const { secret: other_secret } = await mint_key();
    const session_id = await run_a_turn(owner_secret);
    const file = await write_a_file(session_id, 'payouts.csv');

    const listed = await list_files(other_secret, session_id);
    const downloaded = await app.request(`/v1/files/${file.file_id}/content`, {
      headers: key_headers(other_secret),
    });

    expect(listed.status).toBe(404);
    expect(listed.body.error?.code).toBe('not_found');
    expect(downloaded.status).toBe(404);
    expect(((await downloaded.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('lets a request with no API key fall through to the dashboard file route', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret);
    const file = await write_a_file(session_id, 'payouts.csv');

    const response = await app.request(`/v1/files/${file.file_id}/content`);
    const body = (await response.json()) as { data: { content_text: string | null } };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.data.content_text).toBe(new TextDecoder().decode(report_bytes));
  });

  it('reports the rate window on a key-authed response', async () => {
    const { secret } = await mint_key();
    const session_id = await run_a_turn(secret);

    const response = await app.request(`/v1/sessions/${session_id}/files`, {
      headers: key_headers(secret),
    });

    expect(response.headers.get('x-ratelimit-limit')).toBe('120');
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThan(120);
  });

  it('says how long to wait when the window is spent', async () => {
    const { api_key, secret } = await mint_key();
    for (let request = 0; request < api_key_requests_per_window; request++) {
      await count_api_key_request_in_window(db, {
        api_key_id: api_key.api_key_id,
        window_ms: api_key_rate_window_ms,
        request_limit: api_key_requests_per_window,
      });
    }

    const refused = await app.request('/v1/sessions', { headers: key_headers(secret) });

    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(refused.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });
});
