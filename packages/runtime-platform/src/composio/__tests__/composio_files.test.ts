import type { SessionEnv } from '@agent-core/environment';
import type {
  NodeInputSchemaData,
  ToolInputPropertyData,
} from '@coworker/core/db/schema/json_column_types';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';
import { materialize_composio_file_inputs } from '@runtime-platform/composio/composio_files';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetch_public_url } = vi.hoisted(() => ({ fetch_public_url: vi.fn() }));

vi.mock('@runtime-platform/tools/public_url_fetch', () => ({ fetch_public_url }));

const max_file_bytes = 10 * 1024 * 1024;

function file_schema(input: { accepts_many?: boolean } = {}): NodeInputSchemaData {
  const attachment: ToolInputPropertyData = {
    type: input.accepts_many ? 'array' : 'string',
    ...(input.accepts_many ? { items: { type: 'string' } } : {}),
    field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
  };
  return {
    type: 'object',
    properties: { attachment, note: { type: 'string' } },
  };
}

function create_stub_client() {
  const create_file_upload = vi.fn(async (body: { filename: string }) => ({
    id: `upl_${body.filename}`,
    key: `s3/${body.filename}`,
    new_presigned_url: `https://s3.example.com/put/${body.filename}`,
  }));
  const upload_file_bytes = vi.fn(async () => undefined);
  return {
    create_file_upload,
    upload_file_bytes,
    client: { create_file_upload, upload_file_bytes } as unknown as ComposioClient,
  };
}

function materialize(input: {
  tool_input: Record<string, unknown>;
  client: ComposioClient;
  accepts_many?: boolean;
  environment?: SessionEnv | undefined;
}) {
  return materialize_composio_file_inputs({
    tool_input: input.tool_input,
    tool_schema: file_schema({ ...(input.accepts_many ? { accepts_many: true } : {}) }),
    toolkit_slug: 'attio',
    tool_slug: 'ATTIO_CREATE_NOTE',
    ...(input.environment ? { environment: input.environment } : {}),
    client: input.client,
  });
}

function workspace_env(read_bytes: SessionEnv['read_bytes']): SessionEnv {
  return { read_bytes } as unknown as SessionEnv;
}

function streamed_response(input: { chunk_count: number; declared_length: string }) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < input.chunk_count; index += 1) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-length': input.declared_length },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('materialize_composio_file_inputs', () => {
  it('uploads a workspace file and hands Composio the upload envelope', async () => {
    const { client, create_file_upload, upload_file_bytes } = create_stub_client();
    const environment = workspace_env(async () => new Uint8Array([1, 2, 3, 4]));

    const result = await materialize({
      tool_input: { attachment: 'files/report.pdf', note: 'keep me' },
      client,
      environment,
    });

    expect(result).toMatchObject({
      ok: true,
      uploaded_file_count: 1,
      tool_input: {
        attachment: { name: 'report.pdf', mimetype: 'application/pdf', s3key: 's3/report.pdf' },
        note: 'keep me',
      },
    });
    expect(create_file_upload).toHaveBeenCalledWith({
      toolkit_slug: 'attio',
      tool_slug: 'ATTIO_CREATE_NOTE',
      filename: 'report.pdf',
      mimetype: 'application/pdf',
      md5: '08d6c05a21512a79a1dfeb9d2a8f262f',
    });
    expect(upload_file_bytes).toHaveBeenCalledWith(
      'https://s3.example.com/put/report.pdf',
      new Uint8Array([1, 2, 3, 4]),
      'application/pdf',
    );
  });

  it('refuses a workspace path when the run has no readable workspace', async () => {
    const { client, create_file_upload } = create_stub_client();

    const result = await materialize({ tool_input: { attachment: 'files/report.pdf' }, client });

    expect(result).toMatchObject({
      ok: false,
      code: 'workspace_file_unavailable',
      metadata: { field_name: 'attachment', file_path: 'files/report.pdf' },
    });
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('reports the workspace read error and how to name a file instead', async () => {
    const { client, create_file_upload } = create_stub_client();
    const environment = workspace_env(async () => {
      throw new Error('ENOENT: no such file');
    });

    const result = await materialize({
      tool_input: { attachment: 'files/missing.pdf' },
      client,
      environment,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'workspace_file_read_failed',
      metadata: { field_name: 'attachment', file_read_error: 'ENOENT: no such file' },
    });
    expect(result.ok === false && result.message).toContain('publicly readable HTTPS URL');
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('refuses a remote file the host would not serve', async () => {
    const { client, create_file_upload } = create_stub_client();
    fetch_public_url.mockResolvedValue(new Response('nope', { status: 403 }));

    const result = await materialize({
      tool_input: { attachment: 'https://files.example.com/report.pdf' },
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'remote_file_unreadable',
      metadata: { field_name: 'attachment', http_status: 403 },
    });
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('refuses a remote file whose declared length is above the cap, without reading it', async () => {
    const { client, create_file_upload } = create_stub_client();
    const response = new Response('x', {
      status: 200,
      headers: { 'content-length': String(max_file_bytes + 1) },
    });
    fetch_public_url.mockResolvedValue(response);

    const result = await materialize({
      tool_input: { attachment: 'https://files.example.com/huge.zip' },
      client,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'file_too_large',
      metadata: { field_name: 'attachment', byte_limit: max_file_bytes },
    });
    expect(response.bodyUsed).toBe(false);
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('refuses a streamed body that understates its own length', async () => {
    const { client, create_file_upload } = create_stub_client();
    fetch_public_url.mockResolvedValue(
      streamed_response({ chunk_count: 11, declared_length: '10' }),
    );

    const result = await materialize({
      tool_input: { attachment: 'https://files.example.com/liar.bin' },
      client,
    });

    expect(result).toMatchObject({ ok: false, code: 'file_too_large' });
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('uploads every element of an array field and counts each one', async () => {
    const { client, create_file_upload } = create_stub_client();
    const environment = workspace_env(async (file_path) =>
      new TextEncoder().encode(`bytes of ${file_path}`),
    );

    const result = await materialize({
      tool_input: { attachment: ['files/one.png', 'files/two.txt'] },
      client,
      accepts_many: true,
      environment,
    });

    expect(result).toMatchObject({
      ok: true,
      uploaded_file_count: 2,
      tool_input: {
        attachment: [
          { name: 'one.png', mimetype: 'image/png', s3key: 's3/one.png' },
          { name: 'two.txt', mimetype: 'text/plain', s3key: 's3/two.txt' },
        ],
      },
    });
    expect(create_file_upload).toHaveBeenCalledTimes(2);
  });

  it('passes an existing upload envelope through without uploading again', async () => {
    const { client, create_file_upload, upload_file_bytes } = create_stub_client();
    const envelope = { name: 'report.pdf', mimetype: 'application/pdf', s3key: 's3/already' };

    const result = await materialize({ tool_input: { attachment: envelope }, client });

    expect(result).toMatchObject({
      ok: true,
      uploaded_file_count: 0,
      tool_input: { attachment: envelope },
    });
    expect(create_file_upload).not.toHaveBeenCalled();
    expect(upload_file_bytes).not.toHaveBeenCalled();
  });

  it('leaves a null file field alone', async () => {
    const { client, create_file_upload } = create_stub_client();

    const result = await materialize({
      tool_input: { attachment: null, note: 'no file' },
      client,
    });

    expect(result).toMatchObject({
      ok: true,
      uploaded_file_count: 0,
      tool_input: { attachment: null, note: 'no file' },
    });
    expect(create_file_upload).not.toHaveBeenCalled();
  });

  it('does not touch a tool input when the schema declares no file field', async () => {
    const { client, create_file_upload } = create_stub_client();

    const result = await materialize_composio_file_inputs({
      tool_input: { note: 'plain text only' },
      tool_schema: { properties: { note: { type: 'string' } } },
      toolkit_slug: 'attio',
      tool_slug: 'ATTIO_CREATE_NOTE',
      client,
    });

    expect(result).toEqual({
      ok: true,
      tool_input: { note: 'plain text only' },
      uploaded_file_count: 0,
    });
    expect(create_file_upload).not.toHaveBeenCalled();
  });
});
