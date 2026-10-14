import { resize_image_for_model } from '@agent-core/images/resize_image_for_model';
import type { SessionMessageRequest } from '@api/services/sessions/session_message_request';
import type { Database } from '@coworker/core';
import { create_file } from '@coworker/core/db/queries/files';
import {
  default_file_storage_provider,
  generate_file_object_key,
  open_file_object_storage,
  type SessionMessagePart,
  type SessionMessagePayload,
  session_message_payload_schema,
} from '@coworker/runtime-platform';
import { create_id, id_prefixes } from '@coworker/shared';

type RequestPart = NonNullable<SessionMessageRequest['content']>[number];
type RequestImage = Extract<RequestPart, { type: 'image' }>;
type RequestFile = Extract<RequestPart, { type: 'file' }>;

export type PayloadInput = {
  workspace_id: string;
  session_id: string;
  user_id: string;
  client_message_id: string;
  body: SessionMessageRequest;
  multipart_files?: ReadonlyMap<string, File>;
  repeats_run_message_id?: string;
};

type StoreContext = Pick<PayloadInput, 'workspace_id' | 'session_id' | 'user_id'> & {
  db: Database;
};

export async function build_session_message_payload(
  db: Database,
  input: PayloadInput,
): Promise<SessionMessagePayload> {
  const context = { db, ...input };
  const request_parts: RequestPart[] = [
    ...(input.body.content ?? []),
    ...(input.body.images ?? []).map((image) => ({ ...image, type: 'image' as const })),
  ];
  const content = await Promise.all(
    request_parts.map((part) => store_request_part(context, part, input.multipart_files)),
  );
  const { body } = input;
  return session_message_payload_schema.parse({
    version: 1,
    session_id: input.session_id,
    actor_user_id: input.user_id,
    ...(body.message === undefined ? {} : { message: body.message }),
    ...(content.length === 0 ? {} : { content }),
    ...(body.reasoning_level === undefined ? {} : { reasoning_level: body.reasoning_level }),
    ...(body.model_provider === undefined ? {} : { model_provider: body.model_provider }),
    ...(body.model_proxy === undefined ? {} : { model_proxy: body.model_proxy }),
    ...(body.model_name === undefined ? {} : { model_name: body.model_name }),
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(body.max_output_tokens === undefined ? {} : { max_output_tokens: body.max_output_tokens }),
    client_message_id: input.client_message_id,
    ...(input.repeats_run_message_id
      ? { repeats_run_message_id: input.repeats_run_message_id }
      : {}),
  });
}

async function store_request_part(
  context: StoreContext,
  part: RequestPart,
  multipart_files: ReadonlyMap<string, File> | undefined,
): Promise<SessionMessagePart> {
  if (part.type === 'text') return part;
  if (part.type === 'image') return store_image_part(context, part);
  if (part.text !== undefined) return store_inline_text_part(context, { ...part, text: part.text });
  const multipart_file = part.file_id ? multipart_files?.get(part.file_id) : undefined;
  if (multipart_file) return store_multipart_file_part(context, part, multipart_file);
  return {
    type: 'file',
    ...(part.file_id === undefined ? {} : { file_id: part.file_id }),
    ...(part.path === undefined ? {} : { path: part.path }),
    ...(part.url === undefined ? {} : { url: part.url }),
    ...(part.name === undefined ? {} : { name: part.name }),
    ...(part.mime_type === undefined ? {} : { mime_type: part.mime_type }),
    ...(part.read_as === undefined ? {} : { read_as: part.read_as }),
    ...(part.detail === undefined ? {} : { detail: part.detail }),
  };
}

async function store_image_part(
  context: StoreContext,
  part: RequestImage,
): Promise<SessionMessagePart> {
  const resized = await resize_image_for_model(part.data, part.mime_type);
  const mime_type = resized?.mime_type ?? part.mime_type;
  const file_id = await store_message_bytes(context, {
    file_name: part.source || 'image',
    mime_type,
    data: Buffer.from(resized?.data ?? part.data, 'base64'),
  });
  return {
    type: 'file',
    file_id,
    ...(part.source ? { name: part.source } : {}),
    mime_type,
    read_as: 'image',
    ...(part.detail === undefined ? {} : { detail: part.detail }),
  };
}

async function store_inline_text_part(
  context: StoreContext,
  part: RequestFile & { text: string },
): Promise<SessionMessagePart> {
  const file_name = part.name ?? 'message.txt';
  const mime_type = part.mime_type || 'text/plain';
  const file_id = await store_message_bytes(context, {
    file_name,
    mime_type,
    data: new TextEncoder().encode(part.text),
  });
  return { type: 'file', file_id, name: file_name, mime_type, read_as: 'text' };
}

async function store_multipart_file_part(
  context: StoreContext,
  part: RequestFile,
  file: File,
): Promise<SessionMessagePart> {
  const mime_type = file.type || 'application/octet-stream';
  const file_id = await store_message_bytes(context, {
    file_name: file.name,
    mime_type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
  return { type: 'file', file_id, name: part.name ?? file.name, mime_type };
}

async function store_message_bytes(
  context: StoreContext,
  input: { file_name: string; mime_type: string; data: Uint8Array },
) {
  const file_id = create_id(id_prefixes.artifact);
  const storage_key = generate_file_object_key({
    workspace_id: context.workspace_id,
    file_id,
    file_name: input.file_name,
  });
  await open_file_object_storage(default_file_storage_provider).put_if_absent({
    object_key: storage_key,
    data: input.data,
    content_type: input.mime_type,
  });
  await create_file(context.db, {
    file_id,
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    file_purpose: 'user_upload',
    file_status: 'ready',
    file_direction: 'inbound',
    storage_provider: default_file_storage_provider,
    storage_key,
    file_name: input.file_name,
    mime_type: input.mime_type,
    byte_size: input.data.byteLength,
    is_visible: false,
    actor_id: context.user_id,
  });
  return file_id;
}
