export type WorkspaceFolder = {
  readonly path: string;
  readonly holds: string;
  readonly seed_index: boolean;
  readonly model_may_write: boolean;
};

export type WorkspaceLayoutMigrationStep =
  | { readonly move: string; readonly into: string }
  | { readonly delete: string }
  | { readonly keep_symlink_at: readonly string[] }
  | { readonly hand_to_agent: string };

export type WorkspaceLayout = {
  readonly layout_version: number;
  readonly platform_lays_out_workspace: boolean;
  // Extra paths inside the SANDBOX that must reach the same workspace. A volume written under
  // an older layout holds scripts and notes that name the path of its day, and those keep
  // working. Sandbox-local and ephemeral: never a link on the durable volume, which is where
  // links silently became zero-byte files.
  readonly sandbox_workspace_aliases: readonly string[];
  readonly tool_output_folder: string;
  readonly activity_folder: string | null;
  readonly browser_state: {
    readonly relative_to: 'volume_root' | 'workspace';
    readonly sessions: string;
    readonly auth: string;
  };
  readonly volume_workspace_path: string;
  readonly model_root: string;
  readonly folders: readonly WorkspaceFolder[];
  readonly memory_folders: readonly string[];
  readonly memory_files: readonly string[];
  readonly reserved_write_aliases: readonly string[];
  readonly migrate_from: Readonly<Record<number, readonly WorkspaceLayoutMigrationStep[]>>;
};

export const workspace_layout_marker_path = 'system/layout.json';

export const procedures_folder = 'skills';

const scratch_folder = 'tmp';

/** False for a path that lives on the sandbox's own disk rather than the durable volume. */
export function workspace_path_is_durable(relative_path: string) {
  const normalized = relative_path.replace(/^\/+/u, '');
  return normalized !== scratch_folder && !normalized.startsWith(`${scratch_folder}/`);
}

const workspace_layout_v2: WorkspaceLayout = {
  layout_version: 2,
  platform_lays_out_workspace: true,
  sandbox_workspace_aliases: ['/work'],
  tool_output_folder: 'system/tool-output',
  activity_folder: 'system/activity',
  browser_state: {
    relative_to: 'workspace',
    sessions: 'system/browser/sessions',
    auth: 'system/browser/auth',
  },
  volume_workspace_path: 'agents/{agent_id}/workspace',
  model_root: '/workspace',
  folders: [
    { path: 'people', holds: 'one page per person', seed_index: true, model_may_write: true },
    { path: 'companies', holds: 'one page per company', seed_index: true, model_may_write: true },
    {
      path: 'websites',
      holds: 'how to operate a site: login, quirks, gotchas',
      seed_index: true,
      model_may_write: true,
    },
    {
      path: 'tools',
      holds: 'how to operate a tool or API, plus derived clients',
      seed_index: true,
      model_may_write: true,
    },
    { path: 'events', holds: 'what happened, dated', seed_index: true, model_may_write: true },
    { path: 'tasks', holds: 'work in flight, dated', seed_index: true, model_may_write: true },
    { path: 'daily-logs', holds: 'one page per day', seed_index: true, model_may_write: true },
    {
      path: procedures_folder,
      holds: 'how the agent works: one folder per procedure',
      seed_index: true,
      model_may_write: true,
    },
    {
      path: 'files',
      holds: 'what the agent produced or downloaded',
      seed_index: false,
      model_may_write: true,
    },
    {
      path: 'system',
      holds: 'written for the agent, not by it',
      seed_index: false,
      model_may_write: false,
    },
    {
      path: 'system/tool-output',
      holds: 'tool results too big to show in full',
      seed_index: false,
      model_may_write: false,
    },
    {
      path: 'system/activity',
      holds: 'one line per tool call, one file per day',
      seed_index: false,
      model_may_write: false,
    },
    {
      path: 'system/browser',
      holds: 'saved logins and browser sessions',
      seed_index: false,
      model_may_write: false,
    },
  ],
  memory_folders: ['people', 'companies', 'websites', 'tools', 'events', 'tasks', 'daily-logs'],
  memory_files: ['user.md'],
  reserved_write_aliases: ['logs'],
  migrate_from: {
    1: [
      { move: 'clients', into: 'tools' },
      { move: 'downloads', into: 'files' },
      { move: 'screenshots', into: 'files' },
      { move: 'artifacts', into: 'files' },
      { move: 'logs', into: 'system/tool-output' },
      { move: 'repo', into: 'files/legacy-repo' },
      { hand_to_agent: 'files/legacy-repo' },
    ],
  },
};

const workspace_layout_v1: WorkspaceLayout = {
  layout_version: 1,
  platform_lays_out_workspace: false,
  tool_output_folder: 'logs',
  activity_folder: null,
  browser_state: {
    relative_to: 'volume_root',
    sessions: 'system/browser-sessions',
    auth: 'system/browser-auth',
  },
  sandbox_workspace_aliases: ['/work'],
  model_root: '/workspace',
  volume_workspace_path: 'workspace',
  folders: [],
  memory_folders: [],
  memory_files: [],
  reserved_write_aliases: [],
  migrate_from: {},
};

export const workspace_layouts: Readonly<Record<number, WorkspaceLayout>> = {
  1: workspace_layout_v1,
  2: workspace_layout_v2,
};

/**
 * The layout a volume is on. A volume that records no version is on v1: the column was added
 * after those volumes were made, and v1 is the only shape they can be in.
 *
 * Reject a version this deploy does not know rather than guess. A disk written by a newer deploy
 * must never be read through an older record — that is how a workspace gets half-migrated.
 */
export function workspace_layout_for_version(layout_version: number | undefined): WorkspaceLayout {
  const layout = workspace_layouts[layout_version ?? 1];
  if (!layout) {
    throw new Error(
      `Volume records workspace layout version ${layout_version}, which this deploy does not know.`,
    );
  }
  return layout;
}

export const current_workspace_layout = workspace_layout_v2;

/** Where this agent's workspace lives on the volume, relative to the mount root. */
export function volume_workspace_path(agent_id: string, layout = current_workspace_layout) {
  if (!/^[A-Za-z0-9_-]+$/u.test(agent_id)) {
    throw new Error(`Agent id is not usable as a path segment: ${agent_id}`);
  }
  return layout.volume_workspace_path.replace('{agent_id}', agent_id);
}

/**
 * False for a path the platform owns. Read stays open — the agent recovering its own
 * history from system/activity is the point — and only writing is refused.
 */
export function model_may_write_workspace_path(
  workspace_path: string,
  layout = current_workspace_layout,
) {
  const normalized = workspace_path.replace(/^\/+/u, '');
  const is_under = (prefix: string) => normalized === prefix || normalized.startsWith(`${prefix}/`);
  const reserved_folders = layout.folders
    .filter((folder) => !folder.model_may_write)
    .map((folder) => folder.path);
  return ![...reserved_folders, ...layout.reserved_write_aliases].some(is_under);
}

/**
 * Where a path recorded under an old top-level name lives now, or null if it is already
 * current. `files.storage_key` holds the workspace-relative path of every artifact ever
 * produced and the file service reads bytes by it, so those keys have to keep resolving.
 *
 * Resolved here at read time rather than left as symlinks on the disk: a symlink is a second
 * name for a directory that has to be maintained, deleted by hand, and reasoned about by the
 * write deny, and it puts four directories in the agent's workspace that mean nothing to it.
 * Derived from the migration's own move steps, so the reader cannot disagree with the mover.
 */
export function migrated_workspace_path(
  workspace_path: string,
  layout = current_workspace_layout,
): string | null {
  const normalized = workspace_path.replace(/^\/+/u, '');
  for (const step of migration_steps_to_current(1, layout)) {
    if (!('move' in step)) continue;
    if (!normalized.startsWith(`${step.move}/`)) continue;
    return `${step.into}/${normalized.slice(step.move.length + 1)}`;
  }
  return null;
}

/** The migration steps that carry a volume from `from_version` to this layout, in order. */
export function migration_steps_to_current(
  from_version: number,
  layout = current_workspace_layout,
): readonly WorkspaceLayoutMigrationStep[] {
  if (from_version >= layout.layout_version) return [];
  const steps: WorkspaceLayoutMigrationStep[] = [];
  for (let version = from_version; version < layout.layout_version; version += 1) {
    steps.push(...(layout.migrate_from[version] ?? []));
  }
  return steps;
}
