import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import {
  create_stored_file_attachment_sources,
  open_file_bytes,
  set_memory_import_object_storage_for_tests,
} from '@coworker/runtime-platform';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const original_env = {
  ARTIFACT_UPLOAD_BUCKET: env.ARTIFACT_UPLOAD_BUCKET,
  COWORKER_FILE_STORAGE_PATH: env.COWORKER_FILE_STORAGE_PATH,
};
const file_name = 'résumé "final".txt';
const file_bytes = new TextEncoder().encode('bytes kept on local disk');
let db: Database;
let root_directory: string;

beforeEach(async () => {
  db = await create_test_database();
  root_directory = await mkdtemp(path.join(tmpdir(), 'local-file-objects-'));
  Object.assign(env, {
    ARTIFACT_UPLOAD_BUCKET: undefined,
    COWORKER_FILE_STORAGE_PATH: root_directory,
  });
  set_memory_import_object_storage_for_tests(undefined);
  await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'uploader',
    organization_id: 'org_uploader',
    organization_name: 'Uploader Co',
    email: 'uploader@example.test',
    first_name: 'Up',
  });
});

afterEach(async () => {
  vi.useRealTimers();
  Object.assign(env, original_env);
  set_memory_import_object_storage_for_tests(undefined);
  await rm(root_directory, { recursive: true, force: true });
});

describe('uploads with no bucket configured', () => {
  it('stores an upload on disk, then serves it to the agent and to a download', async () => {
    const upload = await mint_upload();
    expect(upload.upload_url).toMatch(/^\/api\/v1\/local_file_objects\?ticket=/);

    const put = await put_bytes(upload, file_bytes);
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);

    const file = await db.query.files.findFirst();
    if (!file) throw new Error('the upload minted no file row');
    const [attachment] = await create_stored_file_attachment_sources(db, {
      workspace_id: file.workspace_id,
      file_ids: [upload.file_id],
      actor_id: 'user_agent',
    });
    expect(attachment).toMatchObject({ byte_size: file_bytes.byteLength, mime_type: 'text/plain' });
    expect(await bytes_of(await attachment?.open_bytes())).toEqual(file_bytes);

    const opened = await open_file_bytes(db, {
      workspace_id: file.workspace_id,
      file_id: upload.file_id,
      actor_id: 'user_agent',
    });
    expect(opened.byte_size).toBe(file_bytes.byteLength);
    expect(await bytes_of(await opened.open_stream())).toEqual(file_bytes);

    const download = await request_download(upload.file_id);
    expect(download.download_url).toMatch(/^\/api\/v1\/local_file_objects\?ticket=/);
    const served = await create_app(db).request(api_path(download.download_url), {
      headers: dashboard_headers(),
    });
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(file_bytes);
    expect(served.headers.get('content-type')).toBe('text/plain');
    expect(served.headers.get('content-length')).toBe(String(file_bytes.byteLength));
    expect(served.headers.get('content-disposition')).toBe(
      `attachment; filename="r_sum_ _final_.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.txt`,
    );
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe('sandbox');
  });

  it('streams a 25 MiB body with no Content-Length through a real HTTP listener', async () => {
    const large_bytes = randomBytes(25 * 1024 * 1024);
    const upload = await mint_upload({
      mime_type: 'application/zip',
      byte_size: large_bytes.length,
    });
    const server = serve({ fetch: create_app(db).fetch, port: 0, hostname: '127.0.0.1' });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const put = await fetch(`${origin}${api_path(upload.upload_url)}`, {
        method: 'PUT',
        headers: dashboard_headers(upload.upload_headers),
        body: chunked_stream(large_bytes, 256 * 1024),
        duplex: 'half',
      } as RequestInit);
      expect(put.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const file = await db.query.files.findFirst();
    if (!file) throw new Error('the upload minted no file row');
    const [attachment] = await create_stored_file_attachment_sources(db, {
      workspace_id: file.workspace_id,
      file_ids: [upload.file_id],
      actor_id: 'user_agent',
    });
    expect(sha256(await bytes_of(await attachment?.open_bytes()))).toBe(sha256(large_bytes));
  });

  it('refuses a body larger or smaller than the signed size and keeps nothing', async () => {
    const upload = await mint_upload();
    const too_large = await put_bytes(upload, new Uint8Array(file_bytes.byteLength + 1));
    const too_small = await put_bytes(upload, file_bytes.slice(1));

    expect(too_large.status).toBe(413);
    expect(too_small.status).toBe(400);
    expect(await stored_file_names()).toEqual([]);
  });

  it('refuses a content type other than the signed one', async () => {
    const upload = await mint_upload();
    const response = await create_app(db).request(api_path(upload.upload_url), {
      method: 'PUT',
      headers: dashboard_headers({ 'Content-Type': 'text/html' }),
      body: file_bytes,
    });

    expect(response.status).toBe(403);
    expect(await stored_file_names()).toEqual([]);
  });

  it('refuses an expired link, a changed ticket, and a ticket for the other operation', async () => {
    const upload = await mint_upload();
    const changed_url = upload.upload_url.replace(/.$/u, (last) => (last === 'A' ? 'B' : 'A'));
    expect((await put_bytes({ ...upload, upload_url: changed_url }, file_bytes)).status).toBe(403);
    const headers = dashboard_headers();
    const with_upload_ticket = await create_app(db).request(api_path(upload.upload_url), {
      headers,
    });
    const with_no_ticket = await create_app(db).request('/v1/local_file_objects', { headers });
    expect(with_upload_ticket.status).toBe(403);
    expect(with_no_ticket.status).toBe(403);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect((await put_bytes(upload, file_bytes)).status).toBe(403);
    expect(await stored_file_names()).toEqual([]);
  });

  it('refuses a valid ticket from a member of another workspace', async () => {
    await provision_workspace_for_identity(db, {
      provider_key: 'workos',
      provider_user_id: 'other_uploader',
      organization_id: 'org_other',
      organization_name: 'Other Co',
      email: 'other@example.test',
      first_name: 'Other',
    });
    const upload = await mint_upload();
    const other_member = dashboard_headers(upload.upload_headers);
    other_member.set(proxy_auth_headers.provider_user_id, 'other_uploader');
    other_member.set(proxy_auth_headers.email, 'other@example.test');
    other_member.set(proxy_auth_headers.organization_id, 'org_other');

    const response = await create_app(db).request(api_path(upload.upload_url), {
      method: 'PUT',
      headers: other_member,
      body: file_bytes,
    });

    expect(response.status).toBe(403);
    expect(await stored_file_names()).toEqual([]);
  });

  it('refuses a valid ticket that does not come through the dashboard', async () => {
    const upload = await mint_upload();
    const headers = dashboard_headers(upload.upload_headers);
    headers.set(proxy_auth_headers.secret, 'not-the-dashboard-secret');
    const app = create_app(db);

    const put = await app.request(api_path(upload.upload_url), {
      method: 'PUT',
      headers,
      body: file_bytes,
    });
    const get = await app.request(api_path(upload.upload_url), { headers });

    expect(put.status).toBe(401);
    expect(get.status).toBe(401);
    expect(await stored_file_names()).toEqual([]);
  });

  it('answers 404 when a bucket is configured, so a ticket never writes to disk', async () => {
    const upload = await mint_upload();
    Object.assign(env, { ARTIFACT_UPLOAD_BUCKET: 'a-real-bucket' });

    expect((await put_bytes(upload, file_bytes)).status).toBe(404);
    expect(await stored_file_names()).toEqual([]);
  });
});

type MintedUpload = {
  file_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
};

async function mint_upload(body: Record<string, unknown> = {}): Promise<MintedUpload> {
  const response = await create_app(db).request('/v1/files/uploads', {
    method: 'POST',
    headers: dashboard_headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      file_name,
      mime_type: 'text/plain',
      byte_size: file_bytes.byteLength,
      ...body,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

async function request_download(file_id: string): Promise<{ download_url: string }> {
  const response = await create_app(db).request(`/v1/files/${file_id}/download`, {
    headers: dashboard_headers(),
  });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

function put_bytes(upload: MintedUpload, bytes: Uint8Array<ArrayBuffer>) {
  return create_app(db).request(api_path(upload.upload_url), {
    method: 'PUT',
    headers: dashboard_headers(upload.upload_headers),
    body: bytes,
  });
}

function api_path(dashboard_url: string) {
  return dashboard_url.replace(/^\/api\//u, '/');
}

async function stored_file_names() {
  const names = await readdir(root_directory, { recursive: true, withFileTypes: true });
  return names.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function bytes_of(stream: ReadableStream<Uint8Array> | undefined) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function chunked_stream(bytes: Uint8Array, chunk_size: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + chunk_size));
      offset += chunk_size;
    },
  });
}

function dashboard_headers(browser_headers: Record<string, string> = {}) {
  const headers = new Headers(browser_headers);
  headers.set(proxy_auth_headers.secret, 'local-development-internal-api-secret');
  headers.set(proxy_auth_headers.provider_key, 'workos');
  headers.set(proxy_auth_headers.provider_user_id, 'uploader');
  headers.set(proxy_auth_headers.email, 'uploader@example.test');
  headers.set(proxy_auth_headers.organization_id, 'org_uploader');
  return headers;
}
