import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { projects } from '@coworker/core/db/schema/projects';
import {
  create_in_memory_object_storage,
  set_memory_import_object_storage_for_tests,
} from '@coworker/runtime-platform';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const test_proxy_secret = 'local-development-internal-api-secret';
let db: Database;

beforeEach(async () => {
  db = await create_test_database();
  set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
  await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'uploader',
    organization_id: 'org_uploader',
    organization_name: 'Uploader Co',
    email: 'uploader@example.test',
    first_name: 'Up',
  });
});

afterEach(() => set_memory_import_object_storage_for_tests(undefined));

describe('POST /v1/files/uploads', () => {
  it('mints a ticket for a file far larger than the proxy body cap', async () => {
    const response = await request_upload({ file_name: 'deck.pdf', byte_size: 9_437_184 });

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.upload_method).toBe('PUT');
    expect(data.upload_headers['Content-Type']).toBe('application/pdf');
    expect(data.upload_url).toContain(encodeURIComponent(`files/${data.file_id}`));

    const artifact = await db.query.files.findFirst();
    expect(artifact).toMatchObject({
      file_status: 'pending',
      file_direction: 'inbound',
      file_purpose: 'user_upload',
      storage_provider: 'object_store',
      byte_size: 9_437_184,
    });
  });

  it('namespaces the object key under the caller workspace', async () => {
    const response = await request_upload({ file_name: 'notes.pdf', byte_size: 1_024 });
    const { data } = await response.json();

    const artifact = await db.query.files.findFirst();
    expect(artifact?.storage_key).toMatch(
      new RegExp(`^workspace/ws_[^/]+/files/${data.file_id}/notes\\.pdf$`),
    );
  });

  it('binds a project upload before the browser receives its storage ticket', async () => {
    const project = await db.query.projects.findFirst({
      where: eq(projects.is_workspace_default, true),
    });
    expect(project).toBeDefined();

    const response = await request_upload({
      file_name: 'brief.pdf',
      byte_size: 1_024,
      project_id: project?.project_id,
    });

    expect(response.status).toBe(201);
    const artifact = await db.query.files.findFirst();
    expect(artifact?.project_id).toBe(project?.project_id);
  });

  it('refuses a file over the attachment limit before any ticket is minted', async () => {
    const response = await request_upload({ file_name: 'huge.zip', byte_size: 64 * 1024 * 1024 });

    expect(response.status).toBe(422);
    expect(await db.query.files.findFirst()).toBeUndefined();
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    const response = await request_upload({
      file_name: 'notes.pdf',
      byte_size: 10,
      storage_provider: 'somewhere_else',
    });

    expect(response.status).toBe(422);
  });

  it('gives two workspaces keys under different prefixes', async () => {
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'other_uploader',
      organization_id: 'org_other',
      organization_name: 'Other Co',
      email: 'other@example.test',
      first_name: 'Other',
    });

    const ours = await request_upload({ file_name: 'a.pdf', byte_size: 10 });
    const theirs = await create_app(db).request('/v1/files/uploads', {
      method: 'POST',
      headers: other_uploader_headers(),
      body: JSON.stringify({ file_name: 'a.pdf', mime_type: 'application/pdf', byte_size: 10 }),
    });
    expect(ours.status).toBe(201);
    expect(theirs.status).toBe(201);

    const files = await db.query.files.findMany();
    const workspace_prefixes = new Set(
      files.map((artifact) => artifact.storage_key.split('/').slice(0, 2).join('/')),
    );
    expect(files).toHaveLength(2);
    expect(workspace_prefixes.size).toBe(2);
  });
});

function other_uploader_headers() {
  const headers = uploader_headers();
  headers.set(proxy_auth_headers.provider_user_id, 'other_uploader');
  headers.set(proxy_auth_headers.email, 'other@example.test');
  headers.set(proxy_auth_headers.organization_id, 'org_other');
  return headers;
}

function request_upload(body: Record<string, unknown>) {
  const app = create_app(db);
  return app.request('/v1/files/uploads', {
    method: 'POST',
    headers: uploader_headers(),
    body: JSON.stringify({ mime_type: 'application/pdf', ...body }),
  });
}

function uploader_headers() {
  const headers = new Headers([[proxy_auth_headers.secret, test_proxy_secret]]);
  headers.set('content-type', 'application/json');
  headers.set(proxy_auth_headers.provider_key, 'workos');
  headers.set(proxy_auth_headers.provider_user_id, 'uploader');
  headers.set(proxy_auth_headers.email, 'uploader@example.test');
  headers.set(proxy_auth_headers.organization_id, 'org_uploader');
  return headers;
}
