import type { Database } from '@coworker/core';
import { to_document_slug } from '@coworker/memory/documents/slug_rules';
import { AppError } from '@coworker/shared';
import {
  list_workspace_volume_folder,
  read_workspace_volume_file,
  resolve_workspace_volume_address,
} from '@runtime-platform/files/workspace_volume_browser';
import {
  has_frontmatter,
  read_body_under_frontmatter,
  read_frontmatter,
} from '@runtime-platform/notifications/frontmatter';
import { z } from 'zod';

const watching_folder = 'watching';

const watching_frontmatter_schema = z.object({
  automation_id: z.string().min(1),
  subject: z.string().min(1).max(500),
  since: z.string().min(1).max(64),
});

export type WatchingNote = {
  slug: string;
  automation_id: string;
  subject: string;
  since: string;
  notes: string;
};

export type WatchingFileReaders = {
  resolve_address?: typeof resolve_workspace_volume_address;
  read_file?: typeof read_workspace_volume_file;
  list_folder?: typeof list_workspace_volume_folder;
};

type WorkspaceAgent = { workspace_id: string; agent_id: string };

/**
 * The note for one automation. Named from the automation itself so the run, the page and the
 * scout reach the same file without anybody storing a path.
 *
 * Renaming an automation moves its note, leaving the old one behind for a person to
 * delete. Key it by automation_id if renames ever become common.
 */
export function watching_file_path(automation_name: string) {
  return `${watching_folder}/${to_document_slug(automation_name)}.md`;
}

export async function list_watching_notes(
  db: Database,
  input: WorkspaceAgent,
  readers: WatchingFileReaders = {},
): Promise<WatchingNote[]> {
  const address = await (readers.resolve_address ?? resolve_workspace_volume_address)(db, input);
  if (!address) return [];
  const listed = await missing_as_null(() =>
    (readers.list_folder ?? list_workspace_volume_folder)(address, watching_folder),
  );
  const names = (listed?.files ?? [])
    .map((file) => file.file_name)
    .filter((file_name) => file_name.endsWith('.md'));
  const notes = await Promise.all(
    names.map(async (file_name) => {
      const bytes = await missing_as_null(() =>
        (readers.read_file ?? read_workspace_volume_file)(
          address,
          `${watching_folder}/${file_name}`,
        ),
      );
      if (!bytes) return null;
      return parse_watching_note(
        file_name.slice(0, -'.md'.length),
        new TextDecoder().decode(bytes),
      );
    }),
  );
  return notes.filter((note): note is WatchingNote => note !== null);
}

export function parse_watching_note(slug: string, file_text: string): WatchingNote | null {
  if (!has_frontmatter(file_text)) return null;
  const parsed = watching_frontmatter_schema.safeParse(read_frontmatter(file_text));
  if (!parsed.success) return null;
  return { slug, ...parsed.data, notes: read_body_under_frontmatter(file_text) };
}

async function missing_as_null<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}
