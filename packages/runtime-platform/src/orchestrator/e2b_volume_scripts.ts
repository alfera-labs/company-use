import path from 'node:path';
import {
  baked_browser_home,
  quote_shell_argument,
  sandbox_home_directory,
} from '@runtime-platform/orchestrator/e2b_command';
import {
  current_workspace_layout,
  migration_steps_to_current,
  volume_workspace_path,
  type WorkspaceLayout,
  workspace_layout_marker_path,
} from '@runtime-platform/storage/workspace_layouts';
import { workspace_seed_files } from '@runtime-platform/storage/workspace_seed_files';

/** The agent's workspace on the mounted volume, e.g. /mnt/archil/agents/ag_1/workspace. */
export function volume_agent_workspace_path(
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  return path.posix.join(volume_root, volume_workspace_path(agent_id, layout));
}

/**
 * Where a volume keeps agent-browser's saved sessions and its auth vault.
 *
 * The layout says which root the two paths hang off, because they are not in the same place in
 * every layout: volumes made before the workspace moved under `agents/` keep browser state
 * beside the workspace rather than inside it. Reading the current layout's answer on one of
 * those volumes looks in a folder that has never existed, and the effect is a person logged
 * out of every site their agent had signed into.
 *
 * Both roots are taken because either may be the base. Pass the sandbox's own roots to get the
 * path the sandbox can reach, or the disk's to get the path Archil takes ownership of.
 */
export function browser_state_path(
  roots: { volume_root: string; workspace_root: string },
  kind: 'auth' | 'sessions',
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const base =
    layout.browser_state.relative_to === 'volume_root' ? roots.volume_root : roots.workspace_root;
  return path.posix.join(base, layout.browser_state[kind]);
}

/** The same state, addressed as the sandbox sees it: the bind mount, not the disk beneath it. */
export function browser_state_path_in_sandbox(
  volume_root: string,
  kind: 'auth' | 'sessions',
  layout: WorkspaceLayout = current_workspace_layout,
) {
  return browser_state_path({ volume_root, workspace_root: layout.model_root }, kind, layout);
}

/** The same state, addressed on the disk, which is what Archil ownership is taken on. */
export function browser_state_path_on_volume(
  volume_root: string,
  agent_id: string,
  kind: 'auth' | 'sessions',
  layout: WorkspaceLayout = current_workspace_layout,
) {
  return browser_state_path(
    {
      volume_root,
      workspace_root: volume_agent_workspace_path(volume_root, agent_id, layout),
    },
    kind,
    layout,
  );
}

function marker_path(workspace_root: string) {
  return path.posix.join(workspace_root, workspace_layout_marker_path);
}

/**
 * Exits 0 only when this volume is already laid out at the current version for this agent.
 * A pure read: a session that passes this probe never claims the volume root.
 */
export function volume_layout_complete_script(
  volume_root: string,
  agent_id: string,
  sandbox_user_identity: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const workspace_root = volume_agent_workspace_path(volume_root, agent_id, layout);
  const owned_by_sandbox_user = (target: string) =>
    `[ "$(stat -c '%u:%g' ${target})" = ${quote_shell_argument(sandbox_user_identity)} ]`;
  const browser_state_exists = browser_state_paths_on_volume(volume_root, agent_id, layout).map(
    (state_path) => `[ -d ${quote_shell_argument(state_path)} ]`,
  );
  if (!layout.platform_lays_out_workspace) {
    const quoted_root = quote_shell_argument(workspace_root);
    return [
      'set -euo pipefail',
      `[ -d ${quoted_root} ]`,
      owned_by_sandbox_user(quoted_root),
      ...browser_state_exists,
    ].join('\n');
  }
  const marker = quote_shell_argument(marker_path(workspace_root));
  return [
    'set -euo pipefail',
    `[ -f ${marker} ]`,
    owned_by_sandbox_user(marker),
    `grep -q '"layout_version": *${layout.layout_version}' ${marker}`,
    `[ -f ${quote_shell_argument(path.posix.join(workspace_root, legacy_cleanup_marker))} ] || ` +
      legacy_layout_paths(volume_root)
        .map((legacy) => `[ ! -e ${quote_shell_argument(legacy)} ]`)
        .join(' && '),
    ...layout.folders.map(
      (folder) => `[ -d ${quote_shell_argument(path.posix.join(workspace_root, folder.path))} ]`,
    ),
    `[ -f ${quote_shell_argument(path.posix.join(workspace_root, 'README.md'))} ]`,
    ...browser_state_exists,
  ].join('\n');
}

/**
 * Hand the volume tree to the sandbox user so it can create files as itself. Must include
 * the mount-root inode, but must skip Archil's own .archil control directory, which is not
 * ours to own and errors on chown. Runs under the root claim; only sets POSIX ownership.
 */
export function volume_ownership_script(
  volume_root: string,
  agent_id: string,
  sandbox_user_identity: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const identity = quote_shell_argument(sandbox_user_identity);
  const workspace_root = volume_agent_workspace_path(volume_root, agent_id, layout);
  return [
    'set -euo pipefail',
    `mkdir -p -- ${quote_shell_argument(workspace_root)}`,
    ...browser_state_paths_on_volume(volume_root, agent_id, layout).map(
      (state_path) => `mkdir -p -- ${quote_shell_argument(state_path)}`,
    ),
    `find ${quote_shell_argument(workspace_root)} -name .archil -prune -o -print0 \\`,
    `  | xargs -0 -r chown -P ${identity} --`,
    ...browser_state_paths_on_volume(volume_root, agent_id, layout).map(
      (state_path) => `chown -P ${identity} -- ${quote_shell_argument(state_path)}`,
    ),
  ].join('\n');
}

function browser_state_paths_on_volume(
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout,
) {
  return (['sessions', 'auth'] as const).map((kind) =>
    browser_state_path_on_volume(volume_root, agent_id, kind, layout),
  );
}

/**
 * Every write to the volume tree: the agent's folders, the seeded files, the forward
 * migration from an older layout, and the version marker. Runs under the root claim and is
 * idempotent, so a session that waited for a concurrent initializer changes nothing.
 */
export function volume_initialization_script(
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout = current_workspace_layout,
  { migrate_existing_layout = false }: { migrate_existing_layout?: boolean } = {},
) {
  const workspace_root = volume_agent_workspace_path(volume_root, agent_id, layout);
  const quoted_root = quote_shell_argument(workspace_root);
  if (layout.layout_version < current_workspace_layout.layout_version && !migrate_existing_layout) {
    return ['set -euo pipefail', `mkdir -p -- ${quoted_root}`].join('\n');
  }
  return [
    'set -euo pipefail',
    `mkdir -p -- ${quoted_root}`,
    ...adopt_previous_layout_lines(volume_root, workspace_root),
    `mkdir -p -- ${layout.folders
      .map((folder) => quote_shell_argument(path.posix.join(workspace_root, folder.path)))
      .join(' ')}`,
    read_previous_version_command(volume_root, workspace_root, layout),
    ...migration_step_lines(workspace_root, layout),
    ...seed_file_lines(workspace_root, layout),
    `printf '%s\\n' ${quote_shell_argument(marker_content(layout))} > ${quote_shell_argument(
      marker_path(workspace_root),
    )}`,
  ].join('\n');
}

export const legacy_cleanup_marker = 'system/legacy-cleanup-ran';

const retired_workspace_entries = [
  'artifacts',
  'downloads',
  'screenshots',
  'logs',
  '.agent-browser',
] as const;

/** The two directories a v1 volume kept at the root of the disk. Nothing else lives there. */
export function legacy_layout_paths(volume_root: string) {
  return [path.posix.join(volume_root, 'workspace'), path.posix.join(volume_root, 'system')];
}

/**
 * Removes the emptied v1 directories from the root of the disk. Root, under the claim,
 * because removing an entry from the mount root needs write on the mount root and the layout
 * runs as the sandbox user — which is why `rmdir` in the adopt step silently did nothing and
 * an empty `workspace/` sat at the disk root.
 *
 * `rmdir` is the whole point: it refuses a non-empty directory and refuses a symlink. Root
 * can therefore only ever remove a directory whose contents were already moved. If anything
 * is left, the directory stays and is visible, which is the correct outcome for data we did
 * not expect and must not delete.
 */
export function legacy_layout_cleanup_script(
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const workspace_root = volume_agent_workspace_path(volume_root, agent_id, layout);
  const system_directory = quote_shell_argument(path.posix.join(workspace_root, 'system'));
  const marker = quote_shell_argument(path.posix.join(workspace_root, legacy_cleanup_marker));
  return [
    'set -euo pipefail',
    ...legacy_layout_paths(volume_root).flatMap((legacy) => {
      const quoted = quote_shell_argument(legacy);
      return [
        `rmdir ${quoted}/browser-auth ${quoted}/browser-sessions 2>/dev/null || true`,
        `rmdir ${quoted} 2>/dev/null || true`,
      ];
    }),
    ...retired_workspace_entries.flatMap((name) => {
      const entry = quote_shell_argument(path.posix.join(workspace_root, name));
      return [
        `[ -L ${entry} ] && rm -f -- ${entry} || true`,
        `[ -d ${entry} ] && rmdir ${entry} 2>/dev/null || true`,
      ];
    }),
    `if [ -d ${system_directory} ] && [ ! -L ${system_directory} ]; then`,
    `  printf '%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${marker}`,
    'fi',
  ].join('\n');
}

function adopt_previous_layout_lines(volume_root: string, workspace_root: string) {
  const legacy_workspace = quote_shell_argument(path.posix.join(volume_root, 'workspace'));
  const legacy_system = quote_shell_argument(path.posix.join(volume_root, 'system'));
  const quoted_root = quote_shell_argument(workspace_root);
  return [
    `if [ -d ${legacy_workspace} ] && [ ! -L ${legacy_workspace} ]; then`,
    `  find ${legacy_workspace} -mindepth 1 -maxdepth 1 -exec mv -n -- {} ${quoted_root}/ \\; || true`,
    'fi',
    `if [ -d ${legacy_system} ]; then`,
    `  mkdir -p -- ${quoted_root}/system/browser`,
    `  [ -d ${legacy_system}/browser-auth ] && mv -n -- ${legacy_system}/browser-auth ${quoted_root}/system/browser/auth || true`,
    `  [ -d ${legacy_system}/browser-sessions ] && mv -n -- ${legacy_system}/browser-sessions ${quoted_root}/system/browser/sessions || true`,
    'fi',
  ];
}

function migration_step_lines(workspace_root: string, layout: WorkspaceLayout) {
  const steps = migration_steps_to_current(1, layout);
  if (steps.length === 0) return [];

  const lines = [`if [ "$previous_layout_version" -lt ${layout.layout_version} ]; then`];
  for (const step of steps) {
    if ('move' in step) {
      const from = quote_shell_argument(path.posix.join(workspace_root, step.move));
      const into = quote_shell_argument(path.posix.join(workspace_root, step.into));
      lines.push(
        `  if [ -d ${from} ] && [ ! -L ${from} ] && [ ! -L ${into} ]; then`,
        `    mkdir -p -- ${into}`,
        `    find ${from} -mindepth 1 -maxdepth 1 -exec mv -n -- {} ${into}/ \\; || true`,
        `    rmdir ${from} 2>/dev/null || true`,
        '  fi',
      );
      continue;
    }
    if ('delete' in step) {
      lines.push(
        `  rm -rf -- ${quote_shell_argument(path.posix.join(workspace_root, step.delete))}`,
      );
      continue;
    }
    if ('keep_symlink_at' in step) {
      for (const old_path of step.keep_symlink_at) {
        const target = symlink_target_for(old_path, layout);
        if (!target) continue;
        lines.push(
          `  if [ ! -e ${quote_shell_argument(path.posix.join(workspace_root, old_path))} ]; then`,
          `    ln -s -- ${quote_shell_argument(target)} ${quote_shell_argument(
            path.posix.join(workspace_root, old_path),
          )}`,
          '  fi',
        );
      }
    }
  }
  lines.push('fi');
  return lines;
}

function symlink_target_for(old_path: string, layout: WorkspaceLayout) {
  for (const step of migration_steps_to_current(1, layout)) {
    if ('move' in step && step.move === old_path) return step.into;
  }
  return undefined;
}

function read_previous_version_command(
  volume_root: string,
  workspace_root: string,
  layout: WorkspaceLayout,
) {
  const marker = quote_shell_argument(marker_path(workspace_root));
  const legacy_marker = quote_shell_argument(path.posix.join(volume_root, '.coworker-initialized'));
  return [
    `previous_layout_version=${layout.layout_version}`,
    `[ -e ${legacy_marker} ] && previous_layout_version=1`,
    `if [ -f ${marker} ]; then`,
    `  previous_layout_version="$(sed -n 's/.*"layout_version" *: *\\([0-9]*\\).*/\\1/p' ${marker} | head -1)"`,
    'fi',
    `case "$previous_layout_version" in '' | *[!0-9]* | ??????*) previous_layout_version=1 ;; esac`,
  ].join('\n');
}

function seed_file_lines(workspace_root: string, layout: WorkspaceLayout) {
  return workspace_seed_files(layout).flatMap((file) => {
    const target = quote_shell_argument(path.posix.join(workspace_root, file.path));
    return [
      `if [ ! -f ${target} ]; then`,
      `  mkdir -p -- ${quote_shell_argument(path.posix.dirname(path.posix.join(workspace_root, file.path)))}`,
      `  printf '%s' ${quote_shell_argument(file.content)} > ${target}`,
      'fi',
    ];
  });
}

function marker_content(layout: WorkspaceLayout) {
  return JSON.stringify({ layout_version: layout.layout_version }, null, 2);
}

/** Sandbox-local root scratch and memory root. Every session, root user, no volume claim. */
export function sandbox_scratch_script(sandbox_user_identity: string) {
  const identity = quote_shell_argument(sandbox_user_identity);
  return [
    'set -euo pipefail',
    'mkdir -p -- /tmp/coworker /memory',
    `chown -h ${identity} -- /tmp/coworker /memory`,
  ].join('\n');
}

/**
 * Bind-mount this agent's workspace at the model root. Root only: the mount needs privilege.
 *
 * It does NOT chmod the mount root, because that cannot work: the mount root is the
 * Archil FUSE filesystem's own inode, read-only on a `--shared` mount and not ours to set, so
 * `chmod 0711 /mnt/coworker` returns EROFS, aborts this script under `set -e`, and fails
 * every sandbox start.
 *
 * So be exact about what this boundary is. The bind mount is what the agent's tools and its
 * working directory address, and volume_ownership_script means the agent owns only its own
 * subtree. What is NOT closed is reaching the raw mount by its absolute path from a shell:
 * `/mnt/coworker` is a fixed constant, still traversable, and another agent's workspace under
 * it would be reachable by a shell that guessed the id. Closing that needs the disk mounted
 * inside a root-only parent directory, which changes volumes.root_path — persisted, and read
 * by teardown — so it is its own change, not a line in this script. Today one volume serves
 * one agent, so there is no sibling tree to reach; this stops being cosmetic the moment that
 * changes.
 */
export function sandbox_bind_script(
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const workspace_root = quote_shell_argument(
    volume_agent_workspace_path(volume_root, agent_id, layout),
  );
  const model_root = quote_shell_argument(layout.model_root);
  return [
    'set -euo pipefail',
    `mkdir -p -- ${model_root}`,
    `mountpoint -q ${model_root} || mount --bind ${workspace_root} ${model_root}`,
    ...layout.sandbox_workspace_aliases
      .filter((alias) => alias !== layout.model_root)
      .flatMap((alias) => {
        const quoted = quote_shell_argument(alias);
        return [`[ -e ${quoted} ] || ln -s -- ${model_root} ${quoted}`];
      }),
  ].join('\n');
}

/**
 * The sandbox-user side of session setup: scratch for this run, and the browser's state
 * links. HOME is the model root (see e2b_command.ts), so agent-browser looks for
 * $HOME/.agent-browser — the two links below point it at durable storage, which is why a
 * saved login outlives its sandbox.
 */
export function sandbox_workspace_link_script(
  run_id: string,
  volume_root: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  const browser_home = quote_shell_argument(
    path.posix.join(sandbox_home_directory, '.agent-browser'),
  );
  const link = (kind: 'sessions' | 'auth') => ({
    from: quote_shell_argument(path.posix.join(sandbox_home_directory, '.agent-browser', kind)),
    to: quote_shell_argument(browser_state_path_in_sandbox(volume_root, kind, layout)),
  });
  const sessions = link('sessions');
  const auth = link('auth');
  const browsers = {
    from: quote_shell_argument(
      path.posix.join(sandbox_home_directory, '.agent-browser', 'browsers'),
    ),
    to: quote_shell_argument(path.posix.join(baked_browser_home, '.agent-browser', 'browsers')),
  };
  const workspace_tmp = quote_shell_argument(path.posix.join(layout.model_root, 'tmp'));
  return [
    'set -euo pipefail',
    `mkdir -p -- ${quote_shell_argument(path.posix.join('/tmp/coworker', run_id))}`,
    `mkdir -p -- ${quote_shell_argument(sandbox_home_directory)}`,
    `[ -L ${workspace_tmp} ] || { rm -rf -- ${workspace_tmp}; ln -s -- /tmp/coworker ${workspace_tmp}; }`,
    ...(layout.platform_lays_out_workspace
      ? [
          `find ${quote_shell_argument(
            path.posix.join(layout.model_root, layout.tool_output_folder),
          )} -type f -mtime +7 -delete 2>/dev/null || true`,
        ]
      : []),
    `mkdir -p -- ${browser_home}`,
    `[ -L ${sessions.from} ] || { rm -rf -- ${sessions.from}; ln -s -- ${sessions.to} ${sessions.from}; }`,
    `[ -L ${auth.from} ] || { rm -rf -- ${auth.from}; ln -s -- ${auth.to} ${auth.from}; }`,
    // Chrome itself is baked into the image, not into HOME — HOME is under /tmp and does not
    // survive. agent-browser only ever looks in $HOME/.agent-browser/browsers, so that name has
    // to point at the baked copy or every cold sandbox re-downloads ~290 MB.
    //
    // Guarded on the target existing: this runs on whatever image the sandbox was started
    // from, and an older one has no /opt/coworker/browser. Linking anyway would leave a
    // dangling browsers/ that agent-browser reads as a broken install, which is worse than
    // the missing link it replaces.
    `if [ -d ${browsers.to} ] && [ ! -L ${browsers.from} ]; then`,
    `  rm -rf -- ${browsers.from}; ln -s -- ${browsers.to} ${browsers.from}`,
    'fi',
  ].join('\n');
}
