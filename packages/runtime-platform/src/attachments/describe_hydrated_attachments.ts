import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { RunAttachmentHydration } from '@runtime-platform/attachments/hydrate_run_attachments';
import { inline_text_attachment_id } from '@runtime-platform/attachments/inline_text_attachment_sources';

export function describe_hydrated_attachments(
  environment: SessionEnv | undefined,
  run_id: string,
  parts: readonly RuntimeAgentMessagePart[],
  hydration: RunAttachmentHydration,
): RuntimeAgentMessagePart[] {
  if (hydration.hydrated.length === 0 && hydration.failed.length === 0) return [...parts];

  const path_by_attachment_id = new Map(
    hydration.hydrated.map((attachment) => [
      attachment.attachment_id,
      generate_agent_visible_path(environment, attachment.workspace_path),
    ]),
  );
  const described = parts.map((part, index) => {
    if (part.type !== 'file' || part.path) return part;
    const attachment_id =
      part.file_id ?? (part.text ? inline_text_attachment_id(run_id, index) : null);
    if (!attachment_id) return part;
    const path = path_by_attachment_id.get(attachment_id);
    return path ? { ...part, path } : part;
  });

  const described_ids = new Set(
    described.flatMap((part) => (part.type === 'file' && part.file_id ? [part.file_id] : [])),
  );
  const extra_parts = hydration.hydrated
    .filter((attachment) => !described_ids.has(attachment.attachment_id))
    .map(
      (attachment): RuntimeAgentMessagePart => ({
        type: 'file',
        ...(attachment.stored_file_id ? { file_id: attachment.stored_file_id } : {}),
        path: generate_agent_visible_path(environment, attachment.workspace_path),
        name: attachment.file_name,
        mime_type: attachment.mime_type,
      }),
    );

  return [...described, ...extra_parts];
}
