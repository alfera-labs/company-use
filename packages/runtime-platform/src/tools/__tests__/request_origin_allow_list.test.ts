import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { apps, nodes } from '@coworker/core/db/schema';
import {
  build_composio_proxy_request,
  read_composio_proxy_method,
} from '@runtime-platform/composio/composio_proxy_request';
import type { CatalogTool } from '@runtime-platform/tools/catalog_tool_types';
import { beforeAll, describe, expect, it } from 'vitest';

const actor_id = 'system:test';
const connected_account_id = 'ca_test';

async function insert_proxy_app(
  db: Database,
  input: { app_name: string; allowed_request_origins: string[] },
) {
  await db.insert(apps).values({
    app_id: `app_${input.app_name}`,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.app_name,
    auth_type: 'oauth2',
    app_status: 'active',
    allowed_request_origins: input.allowed_request_origins,
    metadata: { source: 'composio' },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(nodes).values({
    node_id: `node_${input.app_name}_proxy`,
    app_id: `app_${input.app_name}`,
    app_key: input.app_name,
    node_name: 'post_api_proxy',
    catalog_scope: 'global',
    node_key: `${input.app_name}-post_api_proxy-1`,
    node_version: 1,
    node_display_name: 'POST API proxy request',
    node_kind: 'action',
    input_schema: { type: 'object', properties: { url: { type: 'string' } } },
    runtime_handler: 'composio.api_proxy',
    node_runtime: 'connected_app',
    provider_key: 'composio',
    provider_config_key: `composio:${input.app_name}`,
    node_config: {
      sourced_from: {
        provider: 'composio',
        provider_app_id: input.app_name,
        provider_component_id: 'composio:api_proxy:post',
      },
      composio: { toolkit_slug: input.app_name },
      proxy: {
        method: 'POST',
        url_mode: 'static_domain',
        base_proxy_target_url: input.allowed_request_origins[0] ?? null,
      },
    },
    metadata: { source: 'composio', required_connection: true },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

function build_proxy_request(tool: CatalogTool, tool_input: Record<string, unknown>) {
  const method = read_composio_proxy_method(tool);
  if (!method) throw new Error(`${tool.node_key} has no proxy method`);
  return build_composio_proxy_request(tool_input, tool, { method, connected_account_id });
}

function read_refusal(result: ReturnType<typeof build_proxy_request>) {
  if (result.ok) throw new Error('the proxy request was accepted');
  if (result.error.success) throw new Error('a refusal returned a successful tool result');
  return result.error.error;
}

describe('api proxy request origin allow list', () => {
  let attio: CatalogTool;
  let acme: CatalogTool;
  let no_origins: CatalogTool;

  beforeAll(async () => {
    const db = await create_test_database();
    await insert_proxy_app(db, {
      app_name: 'attio',
      allowed_request_origins: ['https://api.attio.com'],
    });
    await insert_proxy_app(db, {
      app_name: 'acme',
      allowed_request_origins: ['https://*.acme.com'],
    });
    await insert_proxy_app(db, { app_name: 'closed_app', allowed_request_origins: [] });

    attio = await read_catalog_tool(db, 'attio-post_api_proxy-1');
    acme = await read_catalog_tool(db, 'acme-post_api_proxy-1');
    no_origins = await read_catalog_tool(db, 'closed_app-post_api_proxy-1');
  });

  it('accepts an exact allowed origin with and without a path', () => {
    expect(build_proxy_request(attio, { url: 'https://api.attio.com/v2/notes' })).toEqual({
      ok: true,
      request: {
        connected_account_id,
        endpoint: 'https://api.attio.com/v2/notes',
        method: 'POST',
      },
    });
    expect(build_proxy_request(attio, { url: 'https://api.attio.com' })).toMatchObject({
      ok: true,
      request: { endpoint: 'https://api.attio.com/' },
    });
  });

  it('accepts a subdomain of a wildcard allowed origin', () => {
    expect(build_proxy_request(acme, { url: 'https://eu.acme.com/x' })).toMatchObject({
      ok: true,
      request: { endpoint: 'https://eu.acme.com/x' },
    });
  });

  it('refuses a lookalike host and a scheme the wildcard does not cover', () => {
    expect(build_proxy_request(acme, { url: 'https://evilacme.com/x' })).toMatchObject({
      ok: false,
      error: { error: { code: 'invalid_input' } },
    });
    expect(build_proxy_request(acme, { url: 'http://eu.acme.com/x' })).toMatchObject({
      ok: false,
      error: { error: { code: 'invalid_input' } },
    });
  });

  it('refuses a non-http scheme', () => {
    const result = build_proxy_request(attio, { url: 'javascript:alert(1)' });

    expect(read_refusal(result)).toEqual({
      code: 'invalid_input',
      message: 'Absolute proxy URLs must use http or https.',
    });
  });

  it('refuses every absolute URL when the app declares no allowed origins', () => {
    const result = build_proxy_request(no_origins, { url: 'https://api.attio.com/v2/notes' });

    expect(read_refusal(result)).toEqual({
      code: 'invalid_input',
      message: 'Absolute proxy URLs require configured allowed origins.',
    });
    expect(build_proxy_request(no_origins, { url: '/v2/notes' })).toMatchObject({
      ok: true,
      request: { endpoint: '/v2/notes' },
    });
  });

  it('refuses headers and query parameters carrying object values', () => {
    const headers_result = build_proxy_request(attio, {
      url: '/v2/notes',
      headers: { authorization: { token: 'stolen' } },
    });
    const query_result = build_proxy_request(attio, {
      url: '/v2/notes',
      query_parameters: { filter: { name: 'Acme' } },
    });

    expect(read_refusal(headers_result).message).toBe(
      'headers.authorization must be a string, number, or boolean.',
    );
    expect(read_refusal(query_result).message).toBe(
      'query_parameters.filter must be a string, number, or boolean.',
    );
  });
});

async function read_catalog_tool(db: Database, node_key: string) {
  const tool = await get_tool_catalog_entry(db, { node_key });
  if (!tool) throw new Error(`catalog tool ${node_key} was not inserted`);
  return tool;
}
