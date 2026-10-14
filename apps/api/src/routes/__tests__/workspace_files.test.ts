import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const volume_files = new Map<string, Uint8Array>();

vi.mock('@coworker/runtime-platform', async (import_actual) => {
  const actual = await import_actual<typeof import('@coworker/runtime-platform')>();
  return {
    ...actual,
    resolve_workspace_volume_address: async () =>
      ({
        volume_id: 'vol_test',
        provider_volume_id: 'dsk_test',
        volume_workspace_path: 'agents/agt_test/workspace',
      }) as never,
    read_workspace_volume_file: async (_address: unknown, file_path: string) => {
      const bytes = volume_files.get(file_path);
      if (!bytes) throw new Error(`no test file at ${file_path}`);
      return bytes;
    },
  };
});

const test_proxy_secret = 'local-development-internal-api-secret';
let db: Database;

beforeEach(async () => {
  db = await create_test_database();
  volume_files.clear();
  volume_files.set('files/report.html', new TextEncoder().encode('<script>alert(1)</script>'));
  volume_files.set('files/report.pdf', new TextEncoder().encode('%PDF-1.7'));
  await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'reader',
    organization_id: 'org_reader',
    organization_name: 'Reader Co',
    email: 'reader@example.test',
    first_name: 'Read',
  });
});

describe('GET /v1/workspace/files/download', () => {
  it.each([
    ['files/report.html', 'text/html'],
    ['files/report.pdf', 'application/pdf'],
  ])('serves %s inside a sandbox with no content sniffing', async (file_path, content_type) => {
    const response = await download(file_path);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(content_type);
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toContain('inline');
  });
});

function download(file_path: string) {
  return create_app(db).request(
    `/v1/workspace/files/download?file_path=${encodeURIComponent(file_path)}`,
    { headers: reader_headers() },
  );
}

function reader_headers() {
  const headers = new Headers([[proxy_auth_headers.secret, test_proxy_secret]]);
  headers.set(proxy_auth_headers.provider_key, 'workos');
  headers.set(proxy_auth_headers.provider_user_id, 'reader');
  headers.set(proxy_auth_headers.email, 'reader@example.test');
  headers.set(proxy_auth_headers.organization_id, 'org_reader');
  return headers;
}
