import { require_upload_person_reads } from '@api/services/team/team_private_chats';
import { replace_workspace_file } from '@api/services/workspace_files/replace_workspace_file';
import type { Database } from '@coworker/core';
import {
  content_version_for_bytes,
  create_stored_file_attachment_sources,
  limit_attachment_stream,
  runtime_attachment_limits,
  validate_workspace_docx,
  type WorkspaceVolumeAddress,
} from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';

export async function save_uploaded_workspace_file(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    user_id: string;
    address: WorkspaceVolumeAddress;
    file_path: string;
    uploaded_file_id: string;
    expected_version: string;
  },
) {
  await require_upload_person_reads(db, input, input.uploaded_file_id);
  const [source] = await create_stored_file_attachment_sources(db, {
    workspace_id: input.workspace_id,
    file_ids: [input.uploaded_file_id],
    actor_id: input.user_id,
  });
  if (!source)
    throw new AppError('workspace_file_upload_missing', 'The upload was not found.', 404);
  if (source.byte_size > runtime_attachment_limits.max_attachment_bytes) {
    throw new AppError('workspace_file_too_large', 'DOCX files can be at most 25 MiB.', 422);
  }
  const stream = await limit_attachment_stream(source);
  const data = new Uint8Array(await new Response(stream).arrayBuffer());
  await validate_workspace_docx(input.file_path, data);
  const content_version = content_version_for_bytes(data);
  await replace_workspace_file(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    address: input.address,
    file_path: input.file_path,
    data,
    expected_version: input.expected_version,
    content_version,
  });
  return content_version;
}
