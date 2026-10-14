import path from 'node:path';
import { create_logger, format_error_message, sleep } from '@coworker/shared';
import { save_browser_state_with_ownership } from '@runtime-platform/orchestrator/e2b_browser_state_save';
import {
  join_shell_command,
  quote_shell_argument,
} from '@runtime-platform/orchestrator/e2b_command';
import {
  assert_command_succeeded,
  command_failure_detail,
  E2bWorkspaceStopError,
  run_sandbox_command,
} from '@runtime-platform/orchestrator/e2b_volume';
import {
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import type { Sandbox } from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

const log = create_logger('e2b_volume_teardown');

export async function stop_e2b_sandbox_instance(
  sandbox: E2bSandbox,
  input: {
    archil_root_path?: string;
    agent_workspace_path?: string;
    workspace_layout_version?: number;
    browser_command_env?: Record<string, string>;
    stop_previews?: () => Promise<void>;
    keep_for_resume?: boolean;
    reclaim_stuck_browser_state?: boolean;
  },
) {
  const errors: unknown[] = [];
  if (input.archil_root_path) {
    await input.stop_previews?.().catch((error) => errors.push(error));
    await save_browser_state_with_ownership(
      sandbox,
      {
        volume_root: input.archil_root_path,
        workspace_root: path.posix.join(input.archil_root_path, input.agent_workspace_path ?? ''),
      },
      workspace_layout_for_version(input.workspace_layout_version),
      { ...input, reclaim_stuck_browser_state: Boolean(input.reclaim_stuck_browser_state) },
    ).catch((error) => errors.push(error));
    await sync_and_unmount(
      sandbox,
      input.archil_root_path,
      workspace_layout_for_version(input.workspace_layout_version),
    ).catch((error) => errors.push(error));
  }
  const sandbox_kept =
    errors.length === 0 && Boolean(input.keep_for_resume) && (await pause_sandbox(sandbox));
  if (!sandbox_kept) await sandbox.kill().catch((error) => errors.push(error));
  if (errors.length > 0) {
    throw new E2bWorkspaceStopError(
      `Persistent workspace teardown failed: ${errors.map((error) => format_error_message(error)).join('; ')}`,
      { cause: new AggregateError(errors) },
    );
  }
  return { sandbox_kept };
}

// E2B refuses a pause while its node is still writing a previous snapshot, so one retry;
// after that fall back to kill. Losing the pause costs the session's next run a fresh
// create — exactly today's behavior — never anything else, so refusal is a warning, not
// a teardown failure.
async function pause_sandbox(sandbox: E2bSandbox): Promise<boolean> {
  for (const delay_ms of [0, 5_000]) {
    if (delay_ms > 0) await sleep(delay_ms);
    try {
      await sandbox.pause();
      return true;
    } catch (error) {
      log.warn('Sandbox pause was refused.', {
        sandbox_id: sandbox.sandboxId,
        error: format_error_message(error),
      });
    }
  }
  return false;
}

async function sync_and_unmount(sandbox: E2bSandbox, root_path: string, layout: WorkspaceLayout) {
  assert_command_succeeded(
    await run_sandbox_command(sandbox, 'sync', { timeoutMs: 30_000 }).catch((error) => {
      throw new Error(
        `Filesystem sync of ${root_path} did not finish: ${format_error_message(error)}`,
      );
    }),
    'Filesystem sync',
  );
  // The bind comes off before the disk it points into.
  //
  // sandbox_bind_script mounts the agent's workspace at the model root, and that bind is a
  // second reference to the very filesystem being unmounted. Linux will not release a
  // filesystem while a bind of its own subtree is still mounted, so `archil unmount` could
  // never succeed — it waited for a clean shutdown that could not arrive, and hung until the
  // deadline. Three attempts of that is three minutes of teardown and the same failure.
  // So the bind is released first.
  await release_workspace_bind(sandbox, layout.model_root);
  const unmount_attempts = 3;
  let last_failure = '';
  for (let attempt = 1; attempt <= unmount_attempts; attempt++) {
    const unmount = await run_sandbox_command(
      sandbox,
      join_shell_command(['archil', 'unmount', root_path]),
      { timeoutMs: 30_000, user: 'root' },
    ).catch((error) => format_error_message(error));
    if (typeof unmount !== 'string') {
      if (unmount.exit_code === 0) return;
      last_failure = command_failure_detail(unmount);
    } else {
      last_failure = unmount;
    }
    if (attempt < unmount_attempts) {
      await sleep(2_000);
      continue;
    }
    const holder_detail = await describe_mount_holders(sandbox, root_path);
    throw new Error(
      `Archil unmount of ${root_path} failed after ${unmount_attempts} attempts: ${last_failure}${holder_detail}`,
    );
  }
}

async function release_workspace_bind(sandbox: E2bSandbox, model_root: string) {
  const script = [
    `mountpoint -q ${quote_shell_argument(model_root)} || exit 0`,
    `umount ${quote_shell_argument(model_root)} || umount -l ${quote_shell_argument(model_root)}`,
  ].join('\n');
  const result = await run_sandbox_command(sandbox, script, {
    timeoutMs: 20_000,
    user: 'root',
  }).catch((error) => format_error_message(error));
  if (typeof result === 'string' || result.exit_code !== 0) {
    log.warn('Could not release the workspace bind mount before unmounting the disk.', {
      model_root,
      detail: typeof result === 'string' ? result : command_failure_detail(result),
    });
  }
}

async function describe_mount_holders(sandbox: E2bSandbox, root_path: string) {
  const script = [
    'set -u',
    `root=${quote_shell_argument(root_path)}`,
    'for proc in /proc/[0-9]*; do',
    '  name=$(cat "$proc/comm" 2>/dev/null || echo "?")',
    '  for link in "$proc"/cwd "$proc"/root "$proc"/exe "$proc"/fd/*; do',
    '    target=$(readlink "$link" 2>/dev/null) || continue',
    '    case "$target" in "$root"/*|"$root")',
    '      printf "%s %s -> %s\\n" "$name" "$link" "$target"',
    '      break 2',
    '      ;;',
    '    esac',
    '  done',
    'done',
  ].join('\n');
  const holders = await run_sandbox_command(sandbox, script, {
    timeoutMs: 10_000,
    user: 'root',
  }).catch((error) => format_error_message(error));
  if (typeof holders === 'string') return `; holders: (lookup failed: ${holders})`;
  const reported = holders.stdout.trim();
  return `; holders: ${reported || '(none: no process references the mount)'}`;
}
