import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { Database } from '@coworker/core';
import { list_files_by_ids } from '@coworker/core/db/queries/files';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { get_run, get_session_for_user } from '@coworker/core/db/queries/sessions';
import { AppError, id_prefixes, is_id } from '@coworker/shared';
import { create_stored_file_attachment_sources } from '@runtime-platform/attachments/stored_file_attachment_sources';
import type {
  SessionMessagePart,
  SessionMessagePayload,
} from '@runtime-platform/events/session_agent_message_payload';
import { open_file_bytes } from '@runtime-platform/files/open_file_bytes';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';

type MessageRunInput = Pick<
  StartAgentRunInput,
  | 'user_message'
  | 'user_content'
  | 'attachment_sources'
  | 'model_provider'
  | 'model_proxy'
  | 'model_name'
  | 'reasoning_level'
  | 'temperature'
  | 'max_output_tokens'
>;

export async function build_session_message_run_input(
  db: Database,
  input: { workspace_id: string; payload: SessionMessagePayload },
): Promise<MessageRunInput> {
  const { payload } = input;
  const file_ids = read_stored_file_ids(payload.content ?? []);
  await assert_actor_can_read_files(db, {
    workspace_id: input.workspace_id,
    user_id: payload.actor_user_id,
    file_ids,
  });
  const content_parts = await Promise.all(
    (payload.content ?? []).map((part) =>
      restore_message_part(db, {
        workspace_id: input.workspace_id,
        part,
        actor_id: payload.actor_user_id,
      }),
    ),
  );
  const attachment_sources = await create_stored_file_attachment_sources(db, {
    workspace_id: input.workspace_id,
    file_ids: read_attached_file_ids(payload.content ?? []),
    actor_id: payload.actor_user_id,
  });
  return {
    ...(payload.message === undefined ? {} : { user_message: payload.message }),
    user_content:
      content_parts.length > 0
        ? [
            ...(payload.message ? [{ type: 'text' as const, text: payload.message }] : []),
            ...content_parts,
          ]
        : [{ type: 'text', text: payload.message ?? '' }],
    attachment_sources,
    ...(payload.model_provider === undefined ? {} : { model_provider: payload.model_provider }),
    ...(payload.model_proxy === undefined ? {} : { model_proxy: payload.model_proxy }),
    ...(payload.model_name === undefined ? {} : { model_name: payload.model_name }),
    ...(payload.reasoning_level === undefined ? {} : { reasoning_level: payload.reasoning_level }),
    ...(payload.temperature === undefined ? {} : { temperature: payload.temperature }),
    ...(payload.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: payload.max_output_tokens }),
  };
}

function read_stored_file_ids(parts: SessionMessagePart[]) {
  return parts.flatMap((part) => (part.type === 'file' && part.file_id ? [part.file_id] : []));
}

function read_attached_file_ids(parts: SessionMessagePart[]) {
  return parts.flatMap((part) =>
    part.type === 'file' &&
    part.file_id &&
    !part.read_as &&
    is_id(part.file_id, id_prefixes.artifact)
      ? [part.file_id]
      : [],
  );
}

async function restore_message_part(
  db: Database,
  input: { workspace_id: string; part: SessionMessagePart; actor_id: string },
): Promise<RuntimeAgentMessagePart> {
  const { part } = input;
  if (part.type === 'text') return part;
  if (!part.read_as || !part.file_id) return file_reference_part(part);
  const bytes = await read_stored_file(db, { ...input, file_id: part.file_id });
  if (part.read_as === 'image') {
    return {
      type: 'image',
      data: Buffer.from(bytes.data).toString('base64'),
      mime_type: bytes.mime_type,
      ...(part.detail === undefined ? {} : { detail: part.detail }),
      ...(part.name === undefined ? {} : { source: part.name }),
    };
  }
  return {
    type: 'file',
    ...(part.name === undefined ? {} : { name: part.name }),
    mime_type: bytes.mime_type,
    text: new TextDecoder().decode(bytes.data),
  };
}

function file_reference_part(
  part: Extract<SessionMessagePart, { type: 'file' }>,
): RuntimeAgentMessagePart {
  return {
    type: 'file',
    ...(part.file_id === undefined ? {} : { file_id: part.file_id }),
    ...(part.path === undefined ? {} : { path: part.path }),
    ...(part.url === undefined ? {} : { url: part.url }),
    ...(part.name === undefined ? {} : { name: part.name }),
    ...(part.mime_type === undefined ? {} : { mime_type: part.mime_type }),
  };
}

async function read_stored_file(
  db: Database,
  input: { workspace_id: string; file_id: string; actor_id: string },
) {
  const opened = await open_file_bytes(db, input);
  const data = new Uint8Array(await new Response(await opened.open_stream()).arrayBuffer());
  return { data, mime_type: opened.mime_type };
}

async function assert_actor_can_read_files(
  db: Database,
  input: { workspace_id: string; user_id: string; file_ids: string[] },
) {
  const artifact_ids = input.file_ids.filter((file_id) => is_id(file_id, id_prefixes.artifact));
  const files = await list_files_by_ids(db, input.workspace_id, artifact_ids);
  const readable = await Promise.all(files.map((file) => actor_can_read_file(db, input, file)));
  const unreadable = files.filter((_file, index) => !readable[index]).map((file) => file.file_id);
  const missing = artifact_ids.filter((file_id) => !files.some((file) => file.file_id === file_id));
  if (unreadable.length > 0 || missing.length > 0) {
    throw new AppError(
      'attachment_unavailable',
      `Attachments are no longer available: ${[...unreadable, ...missing].join(', ')}`,
      422,
    );
  }
}

async function actor_can_read_file(
  db: Database,
  input: { workspace_id: string; user_id: string },
  file: Awaited<ReturnType<typeof list_files_by_ids>>[number],
) {
  const session_id =
    file.session_id ??
    (file.run_id ? (await get_run(db, input.workspace_id, file.run_id))?.session_id : undefined);
  if (session_id) {
    return Boolean(await get_session_for_user(db, { ...input, session_id }));
  }
  if (file.project_id) {
    return Boolean(await find_visible_project(db, { ...input, project_id: file.project_id }));
  }
  return true;
}
