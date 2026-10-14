import type { ApiEnv } from '@api/lib/context';
import { inline_content_disposition } from '@api/lib/inline_content_disposition';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { list_workspace_files_folder } from '@api/services/workspace_files/list_workspace_files_folder';
import { replace_workspace_file } from '@api/services/workspace_files/replace_workspace_file';
import { save_uploaded_workspace_file } from '@api/services/workspace_files/save_uploaded_workspace_file';
import type { Database } from '@coworker/core/db/connection';
import {
  content_version_for_bytes,
  decode_workspace_text,
  file_has_text_format,
  inline_binary_byte_limit,
  inline_text_byte_limit,
  mime_type_for_file_name,
  read_workspace_volume_file,
  resolve_workspace_volume_address,
  user_may_write_workspace_path,
  validate_workspace_docx,
  validate_workspace_file_path,
} from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

const workspace_path_schema = z
  .string()
  .max(1024)
  .refine((value) => value.trim().length > 0, 'The path cannot be empty.');
const folder_query_schema = z.object({ folder_path: z.string().max(1024).default('') });
const file_query_schema = z.object({ file_path: workspace_path_schema });
const save_file_schema = z.object({
  file_path: workspace_path_schema,
  content_text: z.string(),
  expected_version: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
const save_uploaded_file_schema = z.object({
  file_path: workspace_path_schema,
  uploaded_file_id: z.string().min(1).max(120),
  expected_version: z.string().regex(/^[a-f0-9]{64}$/u),
});
const content_version_pattern = /^[a-f0-9]{64}$/u;

export const workspace_files_routes = new Hono<ApiEnv>()
  .get('/v1/workspace/files', validate_query(folder_query_schema), async (c) => {
    const { folder_path } = c.req.valid('query');
    const address = await resolve_workspace_volume_address(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
    });
    if (!address) {
      return c.json(ok({ volume_ready: false as const, folder_path, folders: [], files: [] }));
    }
    let listed: Awaited<ReturnType<typeof list_workspace_files_folder>>;
    try {
      listed = await list_workspace_files_folder(address, folder_path);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        return c.json(ok({ volume_ready: false as const, folder_path, folders: [], files: [] }));
      }
      throw error;
    }
    return c.json(ok({ volume_ready: true as const, folder_path, ...listed }));
  })
  .get('/v1/workspace/files/content', validate_query(file_query_schema), async (c) => {
    const { file_path } = c.req.valid('query');
    const address = await require_workspace_volume_address(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
    });
    const bytes = await read_workspace_volume_file(address, file_path);
    const content_version = content_version_for_bytes(bytes);
    return c.json(
      ok({
        file_path,
        byte_size: bytes.byteLength,
        content_version,
        may_edit: user_may_write_workspace_path(address.layout, file_path),
        ...describe_inline_content(file_path, bytes),
      }),
    );
  })
  .get('/v1/workspace/files/download', validate_query(file_query_schema), async (c) => {
    const { file_path } = c.req.valid('query');
    const address = await require_workspace_volume_address(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
    });
    const bytes = await read_workspace_volume_file(address, file_path);
    const file_name = file_path.split('/').pop() ?? file_path;
    const content_version = content_version_for_bytes(bytes);
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      ...inline_file_response_headers(file_name),
      'Content-Length': String(bytes.byteLength),
      ETag: `"${content_version}"`,
      'Cache-Control': 'no-store',
    });
  })
  .put(
    '/v1/workspace/files/content',
    bodyLimit({ maxSize: inline_binary_byte_limit }),
    validate_json(save_file_schema),
    async (c) => {
      const { file_path, content_text, expected_version } = c.req.valid('json');
      const address = await require_workspace_volume_address(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
      });
      validate_workspace_file_path(address, file_path);
      const existing_bytes = await read_workspace_volume_file(address, file_path);
      decode_workspace_text(file_path, existing_bytes);
      const data = new TextEncoder().encode(content_text);
      if (data.byteLength > inline_text_byte_limit) {
        throw new AppError('workspace_file_too_large', 'Text files can be at most 1 MiB.', 422);
      }
      const content_version = content_version_for_bytes(data);
      await replace_workspace_file(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
        address,
        file_path,
        data,
        expected_version: expected_version ?? content_version_for_bytes(existing_bytes),
        content_version,
      });
      return c.json(ok({ file_path, saved: true as const, content_version }));
    },
  )
  .put(
    '/v1/workspace/files/bytes',
    bodyLimit({ maxSize: inline_binary_byte_limit }),
    validate_query(file_query_schema),
    async (c) => {
      const { file_path } = c.req.valid('query');
      const expected_version = parse_if_match(c.req.header('If-Match'));
      const data = new Uint8Array(await c.req.arrayBuffer());
      await validate_workspace_docx(file_path, data);
      const address = await require_workspace_volume_address(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
      });
      validate_workspace_file_path(address, file_path);
      const content_version = content_version_for_bytes(data);
      await replace_workspace_file(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
        address,
        file_path,
        data,
        expected_version,
        content_version,
      });
      return c.json(ok({ file_path, saved: true as const, content_version }));
    },
  )
  .put(
    '/v1/workspace/files/upload',
    bodyLimit({ maxSize: 16 * 1024 }),
    validate_json(save_uploaded_file_schema),
    async (c) => {
      const { file_path, uploaded_file_id, expected_version } = c.req.valid('json');
      const address = await require_workspace_volume_address(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
      });
      validate_workspace_file_path(address, file_path);
      const content_version = await save_uploaded_workspace_file(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
        user_id: c.get('user_id'),
        address,
        file_path,
        uploaded_file_id,
        expected_version,
      });
      return c.json(ok({ file_path, saved: true as const, content_version }));
    },
  );

async function require_workspace_volume_address(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  const address = await resolve_workspace_volume_address(db, input);
  if (!address) {
    throw new AppError('workspace_volume_not_ready', 'This workspace has no files yet.', 409);
  }
  return address;
}

function describe_inline_content(file_path: string, bytes: Uint8Array) {
  if (!file_has_text_format(file_path)) {
    return { content_kind: 'binary' as const, content_text: null };
  }
  if (bytes.byteLength > inline_text_byte_limit) {
    return { content_kind: 'too_large' as const, content_text: null };
  }
  return {
    content_kind: 'text' as const,
    content_text: decode_workspace_text(file_path, bytes),
  };
}

function parse_if_match(value: string | undefined) {
  const content_version = value?.replace(/^"|"$/gu, '');
  if (!content_version || !content_version_pattern.test(content_version)) {
    throw new AppError(
      'workspace_file_version_required',
      'Send the file content version in the If-Match header.',
      409,
    );
  }
  return content_version;
}

// Every header for serving stored bytes inline. The bytes are whatever an agent wrote, and the
// app proxies this route from its own origin, so an .html or .svg file would otherwise run its
// script with the reader's session. `Content-Security-Policy: sandbox` puts the rendered
// document in an opaque origin: no cookies, no same-origin API calls, no script it can use
// against the reader. `nosniff` keeps the browser on the declared type. A page that fetches
// these bytes into a blob and renders them itself is unaffected.
function inline_file_response_headers(file_name: string) {
  return {
    'Content-Type': mime_type_for_file_name(file_name),
    'Content-Disposition': inline_content_disposition(file_name),
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
  };
}
