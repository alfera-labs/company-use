import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SessionEnv } from '@agent-core/environment';
import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';
import { list_composio_file_output_paths } from '@coworker/core/integrations/composio_schema';
import { create_logger, format_error_message } from '@coworker/shared';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';
import { mime_type_for_file_name } from '@runtime-platform/files/file_mime_types';
import { list_file_reference_fields } from '@runtime-platform/tools/file_reference_fields';
import { fetch_public_url } from '@runtime-platform/tools/public_url_fetch';
import { save_downloaded_file } from '@runtime-platform/tools/save_downloaded_file';

const max_file_bytes = 10 * 1024 * 1024;

const remote_fetch_timeout_ms = 30_000;

const log = create_logger('composio_files');

export type MaterializedFileInputs =
  | { ok: true; tool_input: Record<string, unknown>; uploaded_file_count: number }
  | { ok: false; code: string; message: string; metadata: Record<string, unknown> };

type ComposioFileArgument = { name: string; mimetype: string; s3key: string };

export async function materialize_composio_file_inputs(input: {
  tool_input: Record<string, unknown>;
  tool_schema: Pick<NodeInputSchemaData, 'properties'>;
  toolkit_slug: string;
  tool_slug: string;
  environment?: SessionEnv | undefined;
  client: ComposioClient;
}): Promise<MaterializedFileInputs> {
  const fields = list_file_reference_fields(input.tool_schema);
  if (fields.length === 0) {
    return { ok: true, tool_input: input.tool_input, uploaded_file_count: 0 };
  }

  const uploaded_entries = await Promise.all(
    fields.map((field) => upload_field_value(field, input)),
  );
  const failure = uploaded_entries.find((entry) => !entry.ok);
  if (failure && !failure.ok) return failure;

  const values = uploaded_entries.flatMap((entry) => (entry.ok ? entry.values : []));
  return {
    ok: true,
    tool_input: { ...input.tool_input, ...Object.fromEntries(values) },
    uploaded_file_count: uploaded_entries.reduce(
      (count, entry) => count + (entry.ok ? entry.uploaded_file_count : 0),
      0,
    ),
  };
}

async function upload_field_value(
  field: { field_name: string; accepts_many: boolean },
  input: {
    tool_input: Record<string, unknown>;
    toolkit_slug: string;
    tool_slug: string;
    environment?: SessionEnv | undefined;
    client: ComposioClient;
  },
) {
  const value = input.tool_input[field.field_name];
  if (value === undefined || value === null) {
    return { ok: true as const, values: [], uploaded_file_count: 0 };
  }

  const references = field.accepts_many && Array.isArray(value) ? value : [value];
  const uploaded = await Promise.all(
    references.map((reference) => upload_file_reference(reference, field.field_name, input)),
  );
  const failure = uploaded.find((entry) => !entry.ok);
  if (failure && !failure.ok) return failure;

  const uploads = uploaded.flatMap((entry) => (entry.ok ? [entry.value] : []));
  const next_value = field.accepts_many && Array.isArray(value) ? uploads : uploads[0];
  return {
    ok: true as const,
    values: next_value === undefined ? [] : [[field.field_name, next_value] as const],
    uploaded_file_count: uploaded.filter((entry) => entry.ok && entry.uploaded).length,
  };
}

async function upload_file_reference(
  reference: unknown,
  field_name: string,
  input: {
    toolkit_slug: string;
    tool_slug: string;
    environment?: SessionEnv | undefined;
    client: ComposioClient;
  },
) {
  if (is_composio_file_argument(reference)) {
    return { ok: true as const, value: reference, uploaded: false };
  }
  if (typeof reference !== 'string' || !reference.trim()) {
    return { ok: true as const, value: reference, uploaded: false };
  }

  const bytes = await read_file_bytes(reference, field_name, input.environment);
  if (!bytes.ok) return bytes;

  const file_name = read_file_name(reference);
  const mimetype = mime_type_for_file_name(file_name);
  const upload = await input.client.create_file_upload({
    toolkit_slug: input.toolkit_slug,
    tool_slug: input.tool_slug,
    filename: file_name,
    mimetype,
    md5: createHash('md5').update(bytes.bytes).digest('hex'),
  });
  await input.client.upload_file_bytes(upload.new_presigned_url, bytes.bytes, mimetype);

  return {
    ok: true as const,
    value: { name: file_name, mimetype, s3key: upload.key } satisfies ComposioFileArgument,
    uploaded: true,
  };
}

async function read_file_bytes(
  reference: string,
  field_name: string,
  environment: SessionEnv | undefined,
) {
  if (/^https?:\/\//iu.test(reference)) return fetch_remote_bytes(reference, field_name);

  if (!environment?.read_bytes) {
    return file_error(
      'workspace_file_unavailable',
      `File input ${field_name} requires a readable runtime workspace.`,
      { field_name, file_path: reference },
    );
  }

  try {
    const bytes = await environment.read_bytes(reference);
    return check_file_size(bytes, field_name, reference);
  } catch (error) {
    const cause = format_error_message(error);
    return file_error(
      'workspace_file_read_failed',
      `Could not read ${reference}: ${cause}. Two references work here: a workspace path (e.g. files/report.pdf) or a publicly readable HTTPS URL.`,
      { field_name, file_path: reference, file_read_error: cause },
    );
  }
}

async function fetch_remote_bytes(url: string, field_name: string) {
  try {
    const response = await fetch_public_url(url, {}, { timeout_ms: remote_fetch_timeout_ms });
    if (!response.ok) {
      return file_error(
        'remote_file_unreadable',
        `File input ${field_name} points at ${url}, which answered ${response.status}. Use a publicly readable URL, or download the file through its own app's connection first.`,
        { field_name, file_path: url, http_status: response.status },
      );
    }
    const bytes = await read_body_within_cap(response);
    if (!bytes) {
      return file_error(
        'file_too_large',
        `File input ${field_name} at ${url} is above the ${max_file_bytes} byte upload limit.`,
        { field_name, file_path: url, byte_limit: max_file_bytes },
      );
    }
    return { ok: true as const, bytes };
  } catch (error) {
    return file_error(
      'remote_file_unreadable',
      `Could not download ${url}: ${format_error_message(error)}.`,
      { field_name, file_path: url },
    );
  }
}

async function read_body_within_cap(response: Response): Promise<Uint8Array | null> {
  const declared_length = Number(response.headers.get('content-length') ?? '0');
  if (declared_length > max_file_bytes) return null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > max_file_bytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return concatenate_chunks(chunks, received);
}

function concatenate_chunks(chunks: Uint8Array[], total_length: number) {
  const bytes = new Uint8Array(total_length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function check_file_size(bytes: Uint8Array, field_name: string, reference: string) {
  if (bytes.byteLength > max_file_bytes) {
    return file_error(
      'file_too_large',
      `File input ${field_name} is ${bytes.byteLength} bytes, above the ${max_file_bytes} byte upload limit.`,
      { field_name, file_path: reference, byte_size: bytes.byteLength },
    );
  }
  return { ok: true as const, bytes };
}

export async function save_composio_file_outputs(input: {
  output: unknown;
  output_schema: unknown;
  environment?: SessionEnv | undefined;
}): Promise<unknown> {
  const paths = list_composio_file_output_paths(input.output_schema);
  if (paths.length === 0) return input.output;

  let output = input.output;
  for (const file_path of paths) {
    output = await replace_at_path(output, file_path, (value) =>
      save_file_download(value, input.environment),
    );
  }
  return output;
}

async function replace_at_path(
  value: unknown,
  segments: string[],
  replace: (value: unknown) => Promise<unknown>,
): Promise<unknown> {
  const [segment, ...rest] = segments;
  if (segment === undefined) return replace(value);

  if (segment === '[]') {
    if (!Array.isArray(value)) return value;
    return Promise.all(value.map((item) => replace_at_path(item, rest, replace)));
  }

  if (!is_output_object(value) || !(segment in value)) return value;
  return { ...value, [segment]: await replace_at_path(value[segment], rest, replace) };
}

async function save_file_download(value: unknown, environment: SessionEnv | undefined) {
  if (!is_output_object(value)) return value;
  const s3url = typeof value.s3url === 'string' ? value.s3url : null;
  if (!s3url) return value;

  const bytes = await download_output_bytes(s3url);
  if (!bytes) return value;

  const source_name = typeof value.name === 'string' && value.name ? value.name : s3url;
  const saved = await save_downloaded_file({ environment, bytes, source_name });
  return saved ?? value;
}

async function download_output_bytes(url: string) {
  try {
    const response = await fetch_public_url(url, {}, { timeout_ms: remote_fetch_timeout_ms });
    if (!response.ok) {
      log.warn('Dropped a Composio file download the provider refused', {
        url_host: read_url_host(url),
        http_status: response.status,
      });
      return null;
    }
    const bytes = await read_body_within_cap(response);
    if (!bytes) {
      log.warn('Dropped a Composio file download above the byte cap', {
        url_host: read_url_host(url),
        byte_limit: max_file_bytes,
      });
    }
    return bytes;
  } catch (error) {
    log.warn('Could not fetch a Composio file download', {
      url_host: read_url_host(url),
      error: format_error_message(error),
    });
    return null;
  }
}

function read_url_host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function read_file_name(reference: string) {
  if (/^https?:\/\//iu.test(reference)) {
    try {
      return path.posix.basename(new URL(reference).pathname) || 'download';
    } catch {
      return 'download';
    }
  }
  return path.posix.basename(reference.replaceAll('\\', '/')) || 'file';
}

function is_composio_file_argument(value: unknown): value is ComposioFileArgument {
  return is_output_object(value) && typeof value.s3key === 'string';
}

function is_output_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function file_error(code: string, message: string, metadata: Record<string, unknown>) {
  return { ok: false as const, code, message, metadata };
}
