import type { SessionEnv } from '@agent-core/environment/session_env';

/** The names in a folder, or undefined when the folder could not be listed at all. */
export async function list_folder_names(
  environment: SessionEnv | undefined,
  folder_path: string,
): Promise<string[] | undefined> {
  if (!environment?.list) return undefined;
  try {
    return read_listed_names(await environment.list({ path: folder_path }));
  } catch {
    return undefined;
  }
}

export function read_listed_names(listed: unknown): string[] {
  if (Array.isArray(listed)) {
    return listed.flatMap((item) =>
      typeof item === 'string'
        ? [item]
        : typeof item === 'object' && item !== null && 'name' in item
          ? [String((item as { name: unknown }).name)]
          : [],
    );
  }
  if (typeof listed === 'object' && listed !== null && 'entries' in listed) {
    return read_listed_names((listed as { entries: unknown }).entries);
  }
  return [];
}
