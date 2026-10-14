import type { SessionEnv } from '@agent-core/environment';
import { format_error_message } from '@coworker/shared';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { write_attachment_to_environment } from '@runtime-platform/attachments/write_attachment_to_environment';

type HydratedRunAttachment = {
  attachment_id: string;
  stored_file_id?: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  workspace_path: string;
};

export type RunAttachmentHydration = {
  hydrated: HydratedRunAttachment[];
  failed: Array<{ attachment_id: string; file_name: string; reason: string }>;
};

export async function hydrate_run_attachments(
  environment: SessionEnv | undefined,
  sources: readonly RuntimeAttachmentSource[],
): Promise<RunAttachmentHydration> {
  if (sources.length === 0 || !environment?.write_bytes) return { hydrated: [], failed: [] };

  const results = await Promise.allSettled(
    sources.map(async (source) => ({
      attachment_id: source.attachment_id,
      ...(source.stored_file_id ? { stored_file_id: source.stored_file_id } : {}),
      file_name: source.file_name,
      mime_type: source.mime_type,
      byte_size: source.byte_size,
      workspace_path: await write_attachment_to_environment(environment, source),
    })),
  );

  const hydrated: HydratedRunAttachment[] = [];
  const failed: RunAttachmentHydration['failed'] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      hydrated.push(result.value);
      return;
    }
    const source = sources[index];
    failed.push({
      attachment_id: source?.attachment_id ?? `attachment-${index}`,
      file_name: source?.file_name ?? 'unknown',
      reason: format_error_message(result.reason),
    });
  });
  return { hydrated, failed };
}
