import {
  create_workspace_credential_for_user,
  generate_resolved_curl_example,
  list_workspace_credentials_for_user,
} from '@api/services/credentials/connection_credential_service';
import type { Database } from '@coworker/core';
import {
  type AppCredentialRule,
  parse_app_config,
} from '@coworker/core/credentials/app_credential_config';
import { afterEach, describe, expect, it, vi } from 'vitest';

const query_mocks = vi.hoisted(() => ({
  disable: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@coworker/core/db/queries/connection_credentials', () => ({
  disable_workspace_credential: query_mocks.disable,
  insert_workspace_credential: query_mocks.insert,
  list_workspace_credentials: query_mocks.list,
}));

const database = {} as Database;
const secret_value = 'customer-secret';

function delivery_rule(overrides: Record<string, unknown> = {}): AppCredentialRule {
  return parse_app_config({
    add_to_every_request: [
      {
        when_the_request_goes_to: 'api.example.com',
        take_the_value_from: 'api_key',
        put_it_in_header: 'Authorization',
        written_as: 'Bearer {value}',
        worked_out_by: 'human_override',
        ...overrides,
      },
    ],
  }).add_to_every_request[0] as AppCredentialRule;
}

function create_credential(
  overrides: Partial<Parameters<typeof create_workspace_credential_for_user>[0]> = {},
) {
  return create_workspace_credential_for_user({
    db: database,
    workspace_id: 'workspace-1',
    created_by: 'user-1',
    display_name: 'Vendor API',
    allowed_hosts: ['api.example.com'],
    secret_values: { api_key: secret_value },
    add_to_every_request: [delivery_rule()],
    ...overrides,
  });
}

afterEach(() => {
  query_mocks.disable.mockReset();
  query_mocks.insert.mockReset();
  query_mocks.list.mockReset();
});

describe('create_workspace_credential_for_user', () => {
  it('rejects an empty display name', async () => {
    await expect(create_credential({ display_name: ' ' })).rejects.toThrow('display_name_required');
  });

  it('rejects an empty host list', async () => {
    await expect(create_credential({ allowed_hosts: [] })).rejects.toThrow(
      'allowed_hosts_required',
    );
  });

  it('rejects a wildcard host', async () => {
    await expect(create_credential({ allowed_hosts: ['*.example.com'] })).rejects.toThrow(
      'wildcard_host_not_supported',
    );
  });

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '169.254.169.254',
    '2130706433',
    'localhost',
    'postgres',
    'api',
    'host.docker.internal',
    'db.internal',
    'metadata.goog',
  ])('rejects %s, a host inside the network, as a host of a credential', async (host) => {
    await expect(create_credential({ allowed_hosts: [host] })).rejects.toThrow('host_not_allowed');
  });

  it('rejects a rule for a host outside the allowlist', async () => {
    await expect(
      create_credential({
        add_to_every_request: [delivery_rule({ when_the_request_goes_to: 'other.example.com' })],
      }),
    ).rejects.toThrow('host_not_allowed');
  });

  it('rejects an empty secret value', async () => {
    await expect(create_credential({ secret_values: { api_key: '' } })).rejects.toThrow(
      'secret_value_required',
    );
  });

  it('returns only created ids', async () => {
    query_mocks.insert.mockResolvedValue({
      connection_id: 'connection-1',
      app_id: 'app-1',
    });

    const result = await create_credential();

    expect(result).toEqual({ connection_id: 'connection-1', app_id: 'app-1' });
    expect(JSON.stringify(result)).not.toContain(secret_value);
  });
});

describe('list_workspace_credentials_for_user', () => {
  it('returns redacted names without a secret', async () => {
    query_mocks.list.mockResolvedValue([
      {
        connection_id: 'connection-1',
        connection_name: 'Vendor API',
        app_display_name: 'Vendor API',
        connection_status: 'active',
        health_status: 'unknown',
        allowed_hosts: ['api.example.com'],
      },
    ]);

    const result = await list_workspace_credentials_for_user({
      db: database,
      workspace_id: 'workspace-1',
    });

    expect(result[0]?.connection_name).toBe('Vendor API');
    expect(JSON.stringify(result)).not.toContain(secret_value);
    expect(query_mocks.list).toHaveBeenCalledWith(database, 'workspace-1');
  });
});

describe('generate_resolved_curl_example', () => {
  it('masks the credential and shows the header name', () => {
    const result = generate_resolved_curl_example({
      rules: [delivery_rule()],
      allowed_hosts: ['api.example.com'],
    });

    expect(result).toContain('Authorization: Bearer ••••••••');
    expect(result).not.toContain(secret_value);
  });
});
