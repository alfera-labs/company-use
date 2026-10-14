import type { Database } from '@coworker/core';
import { AppError } from '@coworker/shared';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  list_workspace_volume_folder,
  read_workspace_volume_file,
  replace_workspace_volume_file,
  resolve_workspace_volume_address,
  write_workspace_volume_file,
} from '@runtime-platform/files/workspace_volume_browser';
import {
  type GoalFile,
  goal_file_path,
  goals_folder,
  parse_goal_file,
  render_goal_file,
} from '@runtime-platform/goals/goal_file_format';

export type GoalFileReaders = {
  resolve_address?: typeof resolve_workspace_volume_address;
  read_file?: typeof read_workspace_volume_file;
  list_folder?: typeof list_workspace_volume_folder;
  write_file?: typeof write_workspace_volume_file;
  replace_file?: typeof replace_workspace_volume_file;
};

type WorkspaceAgent = { workspace_id: string; agent_id: string };

/** Every goal on the volume. A workspace with no volume and a workspace with no goals read alike. */
export async function list_goal_files(
  db: Database,
  input: WorkspaceAgent,
  readers: GoalFileReaders = {},
): Promise<GoalFile[]> {
  const address = await (readers.resolve_address ?? resolve_workspace_volume_address)(db, input);
  if (!address) return [];
  const listed = await missing_as_null(() =>
    (readers.list_folder ?? list_workspace_volume_folder)(address, goals_folder),
  );
  const names = (listed?.files ?? [])
    .map((file) => file.file_name)
    .filter((file_name) => file_name.endsWith('.md'));
  const goals = await Promise.all(
    names.map((file_name) =>
      read_goal_file(db, { ...input, slug: file_name.slice(0, -'.md'.length) }, readers),
    ),
  );
  return goals.flatMap((read) => (read?.goal ? [read.goal] : []));
}

/** One goal, plus the version a write must replace. Null when there is no such file. */
export async function read_goal_file(
  db: Database,
  input: WorkspaceAgent & { slug: string },
  readers: GoalFileReaders = {},
): Promise<{ goal: GoalFile | null; content_version: string } | null> {
  const address = await (readers.resolve_address ?? resolve_workspace_volume_address)(db, input);
  if (!address) return null;
  const bytes = await missing_as_null(() =>
    (readers.read_file ?? read_workspace_volume_file)(address, goal_file_path(input.slug)),
  );
  if (!bytes) return null;
  return {
    goal: parse_goal_file(input.slug, new TextDecoder().decode(bytes)),
    content_version: content_version_for_bytes(bytes),
  };
}

/**
 * Write the goal, replacing the exact file that was read. A goal that is already there is
 * replaced against its own version, so two writers cannot silently overwrite each other's plan.
 */
export async function save_goal_file(
  db: Database,
  input: WorkspaceAgent & { goal: GoalFile },
  readers: GoalFileReaders = {},
): Promise<{ file_path: string }> {
  const address = await (readers.resolve_address ?? resolve_workspace_volume_address)(db, input);
  if (!address) {
    throw new AppError(
      'workspace_volume_unavailable',
      'This workspace has no files volume yet, so there is nowhere to keep a goal.',
      409,
    );
  }
  const file_path = goal_file_path(input.goal.slug);
  const current = await read_goal_file(db, { ...input, slug: input.goal.slug }, readers);
  const data = new TextEncoder().encode(render_goal_file(input.goal));
  if (current) {
    await (readers.replace_file ?? replace_workspace_volume_file)(address, {
      file_path,
      data,
      expected_version: current.content_version,
      content_version: content_version_for_bytes(data),
    });
  } else {
    await (readers.write_file ?? write_workspace_volume_file)(address, { file_path, data });
  }
  return { file_path };
}

async function missing_as_null<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}
