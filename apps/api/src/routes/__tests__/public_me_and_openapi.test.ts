import { create_app } from '@api/app';
import { api_key_requests_per_window } from '@api/lib/api_key_auth';
import {
  build_public_api_openapi_document,
  describe_public_api_server,
  openapi_document_version,
  public_api_paths,
} from '@api/services/openapi/public_api_openapi';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { type ApiKeyScope, create_api_key } from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import type { OpenAPIV3_1 } from 'openapi-types';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

async function mint_key(scopes: ApiKeyScope[]) {
  return create_api_key(db, {
    workspace_id,
    key_name: 'first-touch key',
    scopes,
    key_audience: 'internal',
    environment_label: 'test',
    actor_id,
  });
}

async function get_me(secret: string) {
  const response = await app.request('/v1/me', {
    headers: { authorization: `Bearer ${secret}` },
  });
  return { response, body: (await response.json()) as { data?: MeBody; error?: { code: string } } };
}

type MeBody = {
  api_key_id: string;
  key_prefix: string;
  key_name: string;
  key_audience: string;
  scopes: string[];
  workspace_id: string;
  rate_limit: { window_seconds: number; max_requests: number; remaining?: number };
};

beforeEach(async () => {
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  actor_id = bootstrap.user_id;
  app = create_app(db);
});

describe('GET /v1/me', () => {
  it("reports the key's real identity and live rate limit with no scope required", async () => {
    const { api_key, secret } = await mint_key(['agents.read', 'sessions.read']);

    const { response, body } = await get_me(secret);

    expect(response.status).toBe(200);
    expect(body.data?.api_key_id).toBe(api_key.api_key_id);
    expect(body.data?.workspace_id).toBe(workspace_id);
    expect(body.data?.key_audience).toBe('internal');
    expect(body.data?.scopes).toEqual(['agents.read', 'sessions.read']);
    expect(body.data?.rate_limit).toEqual({
      window_seconds: 60,
      max_requests: api_key_requests_per_window,
      remaining: api_key_requests_per_window - 1,
    });
  });

  it('answers a key that carries no scope at all', async () => {
    const { secret } = await mint_key([]);

    const { response, body } = await get_me(secret);

    expect(response.status).toBe(200);
    expect(body.data?.scopes).toEqual([]);
  });

  it('rejects an invalid key with 401', async () => {
    const { response, body } = await get_me('ak_test_not_a_real_key');

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe('api_key_invalid');
  });
});

describe('GET /v1/openapi.json', () => {
  it('serves an OpenAPI 3.1 document with no auth', async () => {
    const response = await app.request('/v1/openapi.json');
    const document = (await response.json()) as OpenAPIV3_1.Document;

    expect(response.status).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(openapi_document_version);
  });

  it('describes every public path and a bearer security scheme', () => {
    const document = build_public_api_openapi_document();

    for (const path of public_api_paths) {
      expect(document.paths?.[path]).toBeDefined();
    }
    for (const path of [
      '/v1/me',
      '/v1/agents',
      '/v1/agents/{agent_slug}',
      '/v1/sessions',
      '/v1/sessions/{session_id}',
      '/v1/sessions/{session_id}/events',
      '/v1/sessions/{session_id}/events/stream',
      '/v1/sessions/{session_id}/files',
      '/v1/files/{file_id}/content',
      '/v1/mcp',
      '/v1/workspace',
      '/v1/projects',
      '/v1/skills',
      '/v1/integrations',
    ]) {
      expect(document.paths?.[path]).toBeDefined();
    }

    const scheme = document.components?.securitySchemes?.bearer_api_key;
    expect(scheme).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('names the address of a self-hosted install as its server, not a fixed one', () => {
    const request_url = 'http://10.0.0.5:3351/v1/openapi.json';

    expect(describe_public_api_server({ is_self_hosted: true, request_url })).toEqual({
      url: 'http://10.0.0.5:3351',
      description: 'This install',
    });
    expect(
      describe_public_api_server({
        is_self_hosted: true,
        public_api_url: 'https://alfera.example.com/',
        request_url,
      }),
    ).toEqual({ url: 'https://alfera.example.com', description: 'This install' });
  });

  it('keeps the server of the hosted product', () => {
    const hosted = describe_public_api_server({
      is_self_hosted: false,
      public_api_url: 'https://other.example.com',
      request_url: 'http://10.0.0.5:3351/v1/openapi.json',
    });

    expect(hosted).toEqual(build_public_api_openapi_document().servers?.[0]);
    expect(hosted.description).toBe('Production');
  });

  it('round-trips through the openapi-types Document interface', () => {
    const document: OpenAPIV3_1.Document = build_public_api_openapi_document();
    expect(document.paths && Object.keys(document.paths).length).toBeGreaterThan(0);
  });
});
