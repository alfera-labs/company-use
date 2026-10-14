import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import { list_catalog_api_fallback_tools } from '@coworker/core/db/queries/catalog';
import { get_redacted_connection } from '@coworker/core/db/queries/connection_management';
import { nodes } from '@coworker/core/db/schema';
import {
  create_fixture,
  insert_attio_connection,
  read_content_json,
  stub_composio_api,
  tool_context,
} from '@runtime-platform/__tests__/composio_execution_fixture';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Composio catalog execution', () => {
  beforeEach(() => {
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('runs a Composio action through the workspace connected account', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { requests } = stub_composio_api([
      {
        path: '/tools/execute/ATTIO_LIST_RECORDS',
        respond: {
          body: {
            successful: true,
            data: { records: [{ id: 'rec_1', name: 'Acme' }] },
            log_id: 'log_123',
          },
        },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies', limit: 5 } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'attio-list_records-1',
        app_name: 'attio',
        node_name: 'list_records',
        output: { records: [{ id: 'rec_1', name: 'Acme' }] },
      },
      metadata: { source: 'composio', log_id: 'log_123' },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(
      'https://backend.composio.dev/api/v3.1/tools/execute/ATTIO_LIST_RECORDS',
    );
    expect(requests[0]?.headers['x-api-key']).toBe('composio_test_key');
    expect(requests[0]?.body).toEqual({
      connected_account_id: 'ca_test',
      user_id: 'ws_external_attio',
      arguments: { object: 'companies', limit: 5 },
      version: 'latest',
    });
  });

  it('fails the action when Composio answers successful: false', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([
      {
        path: '/tools/execute/ATTIO_LIST_RECORDS',
        respond: {
          body: {
            successful: false,
            data: {},
            error: 'Attio rejected the request: object companies does not exist.',
            log_id: 'log_failed',
          },
        },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'provider_action_failed',
      error_message: 'Attio rejected the request: object companies does not exist.',
      metadata: { log_id: 'log_failed', retryable: false },
    });
    const connection = await get_redacted_connection(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_attio_composio',
    });
    expect(connection?.health_status).toBe('healthy');
  });

  it('marks the connection unhealthy when the refusal reads like a dead credential', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([
      {
        path: '/tools/execute/ATTIO_LIST_RECORDS',
        respond: {
          body: {
            successful: false,
            data: {},
            error: 'invalid authentication credentials',
          },
        },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'connection_expired',
      error_message: expect.stringContaining('runtime-propose_app_sign_in-1'),
    });
    const connection = await get_redacted_connection(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_attio_composio',
    });
    expect(connection?.health_status).toBe('unhealthy');
  });

  it('turns an HTTP 401 from Composio into credential_expired and records it', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([
      {
        path: '/tools/execute/ATTIO_LIST_RECORDS',
        respond: {
          status: 401,
          body: {
            error: {
              message: 'The connected account credential was rejected.',
              status: 401,
              request_id: 'req_401',
              suggested_fix: 'Reconnect the account.',
            },
          },
        },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'credential_expired',
      metadata: { request_id: 'req_401' },
    });
    const connection = await get_redacted_connection(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_attio_composio',
    });
    expect(connection?.health_status).toBe('unhealthy');
  });

  it('forwards a proxy node as one endpoint plus header and query parameters', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { requests } = stub_composio_api([
      {
        path: '/tools/execute/proxy',
        respond: { body: { status: 201, data: { data: { id: 'note_1' } } } },
      },
    ]);

    const result = await fixture.execute_tool(
      {
        node_key: 'attio-post_api_proxy-1',
        input: {
          url: '/v2/notes',
          body: { data: { title: 'Call summary' } },
          query_parameters: { limit: '10' },
          headers: { accept: 'application/json' },
        },
      },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: { output: { data: { id: 'note_1' } } },
      metadata: { upstream_status: 201, proxy_method: 'POST' },
    });
    expect(requests[0]?.body).toEqual({
      connected_account_id: 'ca_test',
      endpoint: '/v2/notes',
      method: 'POST',
      body: { data: { title: 'Call summary' } },
      parameters: [
        { name: 'accept', value: 'application/json', type: 'header' },
        { name: 'limit', value: '10', type: 'query' },
      ],
    });
  });

  it('sends a write action once when Composio answers 502, and says it may have taken effect', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { requests } = stub_composio_api([
      { path: '/tools/execute/ATTIO_LIST_RECORDS', respond: { status: 502, body: {} } },
      { path: '/tools/execute/ATTIO_LIST_RECORDS', respond: { body: { successful: true } } },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false,
      error_code: 'action_outcome_unknown',
      error_message: expect.stringContaining('may already have taken effect'),
      metadata: { retryable: false, upstream_status: 502 },
    });
  });

  it('repeats an action Composio tagged read-only after a 502', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    await fixture.db
      .update(nodes)
      .set({ metadata: { source: 'composio', annotations: { tags: ['readOnlyHint'] } } })
      .where(eq(nodes.node_key, 'attio-list_records-1'));
    const { requests } = stub_composio_api([
      { path: '/tools/execute/ATTIO_LIST_RECORDS', respond: { status: 502, body: {} } },
      {
        path: '/tools/execute/ATTIO_LIST_RECORDS',
        respond: { body: { successful: true, data: { records: [] } } },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, content_json: { output: { records: [] } } });
  });

  it('says a failed proxy send may already have gone out instead of asking for a new request', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([
      {
        path: '/tools/execute/proxy',
        respond: { status: 404, body: { error: { message: 'upstream answered 404' } } },
      },
    ]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-post_api_proxy-1', input: { url: '/v2/emails/send', body: {} } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'send_outcome_unknown',
      error_message: expect.stringContaining('may already have gone out'),
      metadata: { retryable: false, upstream_status: 404 },
    });
  });

  it('refuses a proxy URL that leaves the allowed origins', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { stubbed_fetch } = stub_composio_api([]);

    for (const dangerous_url of [
      'https://attacker.example/v2/notes',
      '//attacker.example/v2/notes',
      '/\\attacker.example/v2/notes',
    ]) {
      const result = await fixture.execute_tool(
        { node_key: 'attio-post_api_proxy-1', input: { url: dangerous_url, body: {} } },
        tool_context(fixture),
      );
      expect(result).toMatchObject({ ok: false, error_code: 'invalid_input' });
    }
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('uploads a workspace file and passes Composio the upload envelope', async () => {
    const file_bytes = Uint8Array.from([37, 80, 68, 70]);
    const read_bytes = vi.fn(async () => file_bytes);
    const fixture = await create_fixture({
      environment: { env_key: 'test', env_kind: 'custom', read_bytes },
    });
    await insert_attio_connection(fixture);
    const { requests } = stub_composio_api([
      {
        path: '/files/upload/request',
        respond: {
          body: {
            id: 'file_1',
            key: 'uploads/customer.pdf',
            new_presigned_url: 'https://s3.example.test/uploads/customer.pdf?signature=abc',
          },
        },
      },
      { path: 's3.example.test', respond: { body: {} } },
      {
        path: '/tools/execute/ATTIO_UPLOAD_ATTACHMENT',
        respond: { body: { successful: true, data: { attachment_id: 'att_1' } } },
      },
    ]);

    const result = await fixture.execute_tool(
      {
        node_key: 'attio-upload_attachment-1',
        input: { record_id: 'rec_1', attachment: 'uploads/customer.pdf' },
      },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: true,
      metadata: { uploaded_file_count: 1 },
    });
    expect(read_bytes).toHaveBeenCalledWith('uploads/customer.pdf');
    expect(requests[0]?.body).toEqual({
      toolkit_slug: 'attio',
      tool_slug: 'ATTIO_UPLOAD_ATTACHMENT',
      filename: 'customer.pdf',
      mimetype: 'application/pdf',
      md5: expect.any(String),
    });
    expect(requests[1]).toMatchObject({
      url: 'https://s3.example.test/uploads/customer.pdf?signature=abc',
      method: 'PUT',
    });
    expect(requests[2]?.body).toMatchObject({
      arguments: {
        record_id: 'rec_1',
        attachment: {
          name: 'customer.pdf',
          mimetype: 'application/pdf',
          s3key: 'uploads/customer.pdf',
        },
      },
    });
  });

  it('refuses to call Composio when the app has no connection', async () => {
    const fixture = await create_fixture();
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({ ok: false, error_code: 'connection_missing' });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('tells the agent a trigger node is not executable', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-new_record-1', input: {} },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'unsupported_catalog_tool',
      error_message: expect.stringContaining('trigger'),
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('refuses a connection that never got a Composio connected account id', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture, {
      external_account_id: null,
      provider_account: { auth_config_id: 'ac_test', toolkit_slug: 'attio' },
    });
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-list_records-1', input: { object: 'companies' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'connection_incomplete',
      error_message: expect.stringContaining('Attio'),
      metadata: { connection_id: 'conn_attio_composio' },
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('refuses an action node that carries no Composio tool slug', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-unslugged_action-1', input: {} },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'invalid_tool',
      error_message: expect.stringContaining('attio-unslugged_action-1'),
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('refuses a proxy node whose catalogued method Composio would not accept', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    const { stubbed_fetch } = stub_composio_api([]);

    const result = await fixture.execute_tool(
      { node_key: 'attio-trace_api_proxy-1', input: { url: '/v2/notes' } },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: false,
      error_code: 'invalid_tool',
      error_message: expect.stringContaining('proxy method'),
    });
    expect(stubbed_fetch).not.toHaveBeenCalled();
  });

  it('gives the model the proxy request boundary instead of an app-specific API', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([]);

    const result = await fixture.find_runtime_tool('runtime-get_tool_schema-1')(
      { node_key: 'attio-post_api_proxy-1' },
      tool_context(fixture),
    );

    expect(result).toMatchObject({
      ok: true,
      content_json: {
        node_key: 'attio-post_api_proxy-1',
        api_proxy_contract: {
          method: 'POST',
          url_mode: 'static_domain',
          base_url: 'https://api.attio.com/',
          allowed_origins: ['https://api.attio.com'],
          endpoint_source: 'official_api_documentation_required',
        },
      },
    });
  });

  it('carries the proxy contract into catalog search results', async () => {
    const fixture = await create_fixture();
    await insert_attio_connection(fixture);
    stub_composio_api([]);

    const result = await fixture.find_runtime_tool('runtime-search_tools-1')(
      { query: 'api', app_name: 'attio', max_results: 5, offset: 0 },
      tool_context(fixture),
    );

    const tools = (read_content_json(result) as { tools: Array<{ node_key: string }> }).tools;
    expect(tools.map((tool) => tool.node_key)).toContain('attio-post_api_proxy-1');
    expect(tools.find((tool) => tool.node_key === 'attio-post_api_proxy-1')).toMatchObject({
      api_proxy_contract: {
        method: 'POST',
        allowed_origins: ['https://api.attio.com'],
        endpoint_source: 'official_api_documentation_required',
      },
    });
  });

  it('counts the composio proxy handler as an api fallback for the app', async () => {
    const fixture = await create_fixture();

    const fallbacks = await list_catalog_api_fallback_tools(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      app_names: ['attio'],
    });

    expect(fallbacks.map((tool) => tool.node_key)).toEqual([
      'attio-post_api_proxy-1',
      'attio-trace_api_proxy-1',
    ]);
    expect(fallbacks.every((tool) => tool.runtime_handler === 'composio.api_proxy')).toBe(true);
  });
});
