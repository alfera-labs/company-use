import { create_app } from '@api/app';
import {
  api_key_rate_window_ms,
  api_key_requests_per_window,
  scope_requires_internal_audience,
} from '@api/lib/api_key_auth';
import { all_api_key_scopes } from '@api/services/api_keys';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { api_keys } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(scopes: ApiKeyScope[]) {
  return create_api_key(db, {
    workspace_id,
    key_name: 'quota key',
    scopes,
    key_audience: 'internal',
    environment_label: 'test',
    actor_id,
  });
}

function current_window_start_time() {
  return new Date(Math.floor(Date.now() / api_key_rate_window_ms) * api_key_rate_window_ms);
}

async function spend_key_quota(api_key_id: string, request_count: number) {
  await db
    .update(api_keys)
    .set({
      rate_window_start_time: current_window_start_time(),
      rate_window_request_count: request_count,
    })
    .where(eq(api_keys.api_key_id, api_key_id));
}

async function read_spent_quota(api_key_id: string) {
  const [row] = await db
    .select({ request_count: api_keys.rate_window_request_count })
    .from(api_keys)
    .where(eq(api_keys.api_key_id, api_key_id));
  return row?.request_count ?? 0;
}

async function read_workspace(secret: string) {
  const response = await app.request('/v1/workspace', {
    headers: { authorization: `Bearer ${secret}` },
  });
  return {
    status: response.status,
    body: (await response.json()) as { error?: { code: string; details?: unknown } },
  };
}

describe('brain API key rate limiting', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
  });

  it('answers 429 with a retry hint once the key has spent its window', async () => {
    const { api_key, secret } = await mint_key(['workspace.read']);
    await spend_key_quota(api_key.api_key_id, api_key_requests_per_window);

    const { status, body } = await read_workspace(secret);

    expect(status).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
    expect(body.error?.details).toEqual({
      retry_after_seconds: Math.ceil(api_key_rate_window_ms / 1000),
    });
  });

  it('still serves the last request inside the window', async () => {
    const { api_key, secret } = await mint_key(['workspace.read']);
    await spend_key_quota(api_key.api_key_id, api_key_requests_per_window - 1);

    expect((await read_workspace(secret)).status).toBe(200);
  });

  it('refuses a request missing the scope without charging the key', async () => {
    const { api_key, secret } = await mint_key(['answers.write']);

    const { status, body } = await read_workspace(secret);

    expect(status).toBe(403);
    expect(body.error?.code).toBe('scope_missing');
    expect(await read_spent_quota(api_key.api_key_id)).toBe(0);
  });

  it('charges the key when the scope does allow the request', async () => {
    const { api_key, secret } = await mint_key(['workspace.read']);

    expect((await read_workspace(secret)).status).toBe(200);

    expect(await read_spent_quota(api_key.api_key_id)).toBe(1);
  });
});

describe('API key audience classification', () => {
  const expected_audience: Record<ApiKeyScope, ApiKeyAudience> = {
    'answers.write': 'external',
    'memory.read': 'external',
    'memory.write': 'external',
    'agents.read': 'internal',
    'agents.write': 'internal',
    'sessions.read': 'internal',
    'sessions.write': 'internal',
    'projects.read': 'internal',
    'automations.read': 'internal',
    'automations.write': 'internal',
    'skills.read': 'internal',
    'usage.read': 'internal',
    'integrations.read': 'internal',
    'workspace.read': 'internal',
    'workspace.write': 'internal',
    'chat.completions': 'internal',
  };

  it('classifies every scope the mint endpoint accepts', () => {
    expect(all_api_key_scopes).toEqual(
      expect.arrayContaining([
        'agents.read',
        'agents.write',
        'sessions.read',
        'sessions.write',
        'projects.read',
        'skills.read',
        'integrations.read',
        'workspace.read',
        'workspace.write',
        'chat.completions',
      ]),
    );
    for (const scope of all_api_key_scopes) {
      const audience = scope_requires_internal_audience(scope) ? 'internal' : 'external';
      expect({ scope, audience }).toEqual({ scope, audience: expected_audience[scope] });
    }
  });

  it('treats a scope nobody classified as internal-only', () => {
    expect(scope_requires_internal_audience('billing.write' as ApiKeyScope)).toBe(true);
  });
});
