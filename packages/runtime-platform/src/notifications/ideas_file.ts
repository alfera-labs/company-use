import type { Database } from '@coworker/core';
import { create_logger, format_error_message } from '@coworker/shared';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  read_workspace_volume_file,
  replace_workspace_volume_file,
  resolve_workspace_volume_address,
  write_workspace_volume_file,
} from '@runtime-platform/files/workspace_volume_browser';
import type { Notification } from '@runtime-platform/notifications/notification_body';

const log = create_logger('ideas_file');

const ideas_file_name = 'ideas.md';

export type IdeasFileWriters = {
  resolve_address?: typeof resolve_workspace_volume_address;
  read_file?: typeof read_workspace_volume_file;
  write_file?: typeof write_workspace_volume_file;
  replace_file?: typeof replace_workspace_volume_file;
};

export async function append_parked_idea(
  db: Database,
  input: { workspace_id: string; agent_id: string; notification: Notification; now?: Date },
  writers: IdeasFileWriters = {},
): Promise<{ appended: boolean; reason?: string }> {
  try {
    return await append_or_create(db, input, writers);
  } catch (error) {
    const reason = format_error_message(error);
    log.warn('a parked idea could not be written to ideas.md', {
      workspace_id: input.workspace_id,
      reason,
    });
    return { appended: false, reason };
  }
}

async function append_or_create(
  db: Database,
  input: { workspace_id: string; agent_id: string; notification: Notification; now?: Date },
  writers: IdeasFileWriters,
) {
  const address = await (writers.resolve_address ?? resolve_workspace_volume_address)(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
  });
  if (!address) return { appended: false, reason: 'this workspace has no files volume yet' };

  const current = await read_missing_as_null(() =>
    (writers.read_file ?? read_workspace_volume_file)(address, ideas_file_name),
  );
  const section = render_idea_section(input.notification, input.now ?? new Date());
  const existing = current ? new TextDecoder().decode(current) : null;
  const data = new TextEncoder().encode(
    existing === null
      ? `${ideas_file_opening_words}\n${section}`
      : `${existing.trimEnd()}\n\n${section}`,
  );

  if (existing === null) {
    await (writers.write_file ?? write_workspace_volume_file)(address, {
      file_path: ideas_file_name,
      data,
    });
  } else {
    await (writers.replace_file ?? replace_workspace_volume_file)(address, {
      file_path: ideas_file_name,
      data,
      expected_version: content_version_for_bytes(current as Uint8Array),
      content_version: content_version_for_bytes(data),
    });
  }
  return { appended: true };
}

const ideas_file_opening_words = [
  '# Ideas',
  '',
  'Things worth keeping that were not worth interrupting you for. Ask about any of them in chat.',
  '',
].join('\n');

function render_idea_section(notification: Notification, now: Date) {
  return [
    `## ${now.toISOString().slice(0, 10)} — ${notification.title}`,
    '',
    notification.body,
    '',
    `Because: ${notification.reason}`,
  ].join('\n');
}

async function read_missing_as_null(read: () => Promise<Uint8Array>) {
  try {
    return await read();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const status = (error as { status?: number } | null)?.status;
    if (status === 404 || code === 'workspace_file_not_found' || code === 'ENOENT') return null;
    throw error;
  }
}
