import { create_logger, format_error_message, sleep } from '@coworker/shared';
import { join_shell_command } from '@runtime-platform/orchestrator/e2b_command';
import {
  browser_state_path_on_volume,
  legacy_layout_cleanup_script,
  sandbox_bind_script,
  sandbox_scratch_script,
  sandbox_workspace_link_script,
  volume_initialization_script,
  volume_layout_complete_script,
  volume_ownership_script,
} from '@runtime-platform/orchestrator/e2b_volume_scripts';
import { create_sandbox_env } from '@runtime-platform/orchestrator/sandbox_env';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import {
  current_workspace_layout,
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import { CommandExitError, type Sandbox } from 'e2b';

const log = create_logger('e2b_volume');

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

export class E2bVolumeError extends Error {
  readonly error_code = 'volume_mount_failed';
}

export class E2bWorkspaceStopError extends Error {
  readonly error_code = 'volume_unmount_failed';
}

export type SandboxCommandResult = { exit_code: number; stdout: string; stderr: string };

type SandboxCommandOptions = {
  timeoutMs?: number;
  user?: string;
  cwd?: string;
  envs?: Record<string, string>;
};

// commands.run throws CommandExitError on ANY non-zero exit, and the thrown message
// is only "exit status N" — the command's stderr never reaches the caller. Normalize
// here so every failure carries the command's own explanation.
export async function run_sandbox_command(
  sandbox: E2bSandbox,
  command: string,
  options: SandboxCommandOptions,
): Promise<SandboxCommandResult> {
  try {
    const result = await sandbox.commands.run(command, options);
    return { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return { exit_code: error.exitCode, stdout: error.stdout, stderr: error.stderr };
    }
    throw error;
  }
}

export function command_failure_detail(result: SandboxCommandResult) {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.exit_code}`;
}

export function assert_command_succeeded(result: SandboxCommandResult, operation: string) {
  if (result.exit_code === 0) return;
  throw new Error(`${operation} failed: ${command_failure_detail(result)}`);
}

export async function mount_archil_volume(sandbox: E2bSandbox, volume: OpenVolume) {
  if (!volume.provider_region) throw new Error('Archil mount requires a region.');
  const existing_mount = await run_sandbox_command(
    sandbox,
    join_shell_command(['mountpoint', '-q', volume.root_path]),
    { timeoutMs: 10_000 },
  );
  if (existing_mount.exit_code === 0) return;
  assert_command_succeeded(
    await run_sandbox_command(sandbox, join_shell_command(['mkdir', '-p', volume.root_path]), {
      user: 'root',
    }),
    'Archil mountpoint creation',
  );
  assert_command_succeeded(
    await run_sandbox_command(
      sandbox,
      join_shell_command([
        'archil',
        'mount',
        volume.provider_volume_id,
        volume.root_path,
        '--region',
        volume.provider_region,
        '--shared',
      ]),
      {
        timeoutMs: 120_000,
        user: 'root',
        envs: create_sandbox_env({ ARCHIL_MOUNT_TOKEN: volume.mount_token }),
      },
    ),
    `Archil mount of ${volume.provider_volume_id}`,
  );
}

const delegation_conflict_marker = 'outstanding delegation';

export type CheckoutWait = {
  attempts: number;
  delay_ms: number;
  reclaim_on_last_attempt?: boolean;
};

// Claim per-file write ownership on a shared mount. checkout is recursive over children, so
// claiming a directory serializes every writer under it. A conflicting claim is usually held for
// the few seconds a peer's setup runs, so a conflict waits and retries instead of failing.
//
// A claim outliving every retry is not a slow peer. Archil never releases a delegation on its
// own: its own documentation says a client that crashes or powers off "without cleanly unmounting
// or calling archil checkin" keeps the claim, and the only ways back are `archil checkout --force`
// or revoking it through the API. This code used to describe that state as "a dead client Archil
// has not reaped yet" and wait for a reaping that never comes, so the path stayed read-only for
// every later session, even with no other run alive.
//
// So the last attempt reclaims. --force "will revoke any existing delegation from another client",
// which their docs warn "can result in data loss for any outstanding writes from other clients" —
// hence last only, after every polite retry, and only where the caller opts in. A live peer is
// still writing and must keep its claim; a dead one is holding a lock nothing will ever release.
//
// --yes is not optional here. `archil checkout --help` on the binary in our template (v0.8.35):
// "-y, --yes  Skip the interactive confirmation prompt for `--force`". We run every command with no
// stdin, so --force alone stops at that prompt and exits non-zero: a reclaim without --yes can
// never reclaim anything. The published CLI docs list --force but not --yes, which is why this
// was read off the binary instead.
export async function archil_checkout(
  sandbox: E2bSandbox,
  archil_path: string,
  wait: CheckoutWait = { attempts: 8, delay_ms: 2_000 },
) {
  for (let attempt = 1; attempt <= wait.attempts; attempt++) {
    const is_last_attempt = attempt === wait.attempts;
    const reclaim = Boolean(wait.reclaim_on_last_attempt) && is_last_attempt;
    const result = await run_sandbox_command(
      sandbox,
      join_shell_command([
        'archil',
        'checkout',
        ...(reclaim ? ['--force', '--yes'] : []),
        archil_path,
      ]),
      { timeoutMs: 30_000, user: 'root' },
    );
    if (result.exit_code === 0) return;
    const detail = command_failure_detail(result);
    if (!detail.includes(delegation_conflict_marker) || is_last_attempt) {
      throw new Error(
        `Archil checkout of ${archil_path} failed after ${attempt} attempt(s)${
          reclaim ? ' (including a --force reclaim)' : ''
        }: ${detail}`,
      );
    }
    await sleep(wait.delay_ms);
  }
}

export async function archil_checkin(sandbox: E2bSandbox, archil_path: string) {
  assert_command_succeeded(
    await run_sandbox_command(sandbox, join_shell_command(['archil', 'checkin', archil_path]), {
      timeoutMs: 30_000,
      user: 'root',
    }),
    `Archil checkin of ${archil_path}`,
  );
}

export async function assert_archil_mount_healthy(sandbox: E2bSandbox, root_path: string) {
  const health = await run_sandbox_command(
    sandbox,
    join_shell_command(['mountpoint', '-q', root_path]),
    { timeoutMs: 10_000 },
  );
  if (health.exit_code !== 0) throw new Error('Archil mount did not become healthy.');
}

export async function prepare_archil_volume(
  sandbox: E2bSandbox,
  volume: OpenVolume,
  input: { run_id: string; agent_id: string },
) {
  const { run_id, agent_id } = input;
  const layout = workspace_layout_for_version(volume.workspace_layout_version);
  const sandbox_user_identity = await read_sandbox_user_identity(sandbox);
  if (
    !(await volume_layout_is_complete(
      sandbox,
      volume.root_path,
      agent_id,
      sandbox_user_identity,
      layout,
    ))
  ) {
    await initialize_volume_layout(
      sandbox,
      volume.root_path,
      agent_id,
      sandbox_user_identity,
      layout,
    );
  }
  await prepare_sandbox_scratch(sandbox, sandbox_user_identity);
  await bind_workspace_into_sandbox(sandbox, volume.root_path, agent_id, layout);
  await link_sandbox_workspace(sandbox, run_id, volume.root_path, layout);
  await claim_browser_state_ownership(sandbox, volume.root_path, agent_id, layout);
}

export async function claim_browser_state_ownership(
  sandbox: E2bSandbox,
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout = current_workspace_layout,
) {
  for (const state_path of [
    browser_state_path_on_volume(volume_root, agent_id, 'sessions', layout),
    browser_state_path_on_volume(volume_root, agent_id, 'auth', layout),
  ]) {
    await archil_checkout(sandbox, state_path, { attempts: 2, delay_ms: 1_000 }).catch((error) => {
      log.warn('Browser state ownership not acquired; autosaves will not persist this run.', {
        archil_path: state_path,
        error: format_error_message(error),
      });
    });
  }
}

async function volume_layout_is_complete(
  sandbox: E2bSandbox,
  volume_root: string,
  agent_id: string,
  sandbox_user_identity: string,
  layout: WorkspaceLayout,
) {
  const probe = await run_sandbox_command(
    sandbox,
    volume_layout_complete_script(volume_root, agent_id, sandbox_user_identity, layout),
    { timeoutMs: 15_000 },
  );
  return probe.exit_code === 0;
}

async function initialize_volume_layout(
  sandbox: E2bSandbox,
  volume_root: string,
  agent_id: string,
  sandbox_user_identity: string,
  layout: WorkspaceLayout,
) {
  await archil_checkout(sandbox, volume_root, {
    attempts: 8,
    delay_ms: 2_000,
    reclaim_on_last_attempt: true,
  });
  try {
    assert_command_succeeded(
      await run_sandbox_command(
        sandbox,
        volume_ownership_script(volume_root, agent_id, sandbox_user_identity, layout),
        { timeoutMs: 60_000, user: 'root' },
      ),
      'Archil volume ownership handoff',
    );
    assert_command_succeeded(
      await run_sandbox_command(
        sandbox,
        volume_initialization_script(volume_root, agent_id, layout),
        { timeoutMs: 120_000 },
      ),
      'Persistent workspace initialization',
    );
    assert_command_succeeded(
      await run_sandbox_command(
        sandbox,
        legacy_layout_cleanup_script(volume_root, agent_id, layout),
        { timeoutMs: 30_000, user: 'root' },
      ),
      'Legacy workspace cleanup',
    );
  } finally {
    await archil_checkin(sandbox, volume_root);
  }
}

async function prepare_sandbox_scratch(sandbox: E2bSandbox, sandbox_user_identity: string) {
  assert_command_succeeded(
    await run_sandbox_command(sandbox, sandbox_scratch_script(sandbox_user_identity), {
      timeoutMs: 30_000,
      user: 'root',
    }),
    'Sandbox scratch preparation',
  );
}

async function bind_workspace_into_sandbox(
  sandbox: E2bSandbox,
  volume_root: string,
  agent_id: string,
  layout: WorkspaceLayout,
) {
  assert_command_succeeded(
    await run_sandbox_command(sandbox, sandbox_bind_script(volume_root, agent_id, layout), {
      timeoutMs: 60_000,
      user: 'root',
    }),
    'Workspace bind mount',
  );
}

export async function link_sandbox_workspace(
  sandbox: E2bSandbox,
  run_id: string,
  volume_root: string,
  layout: WorkspaceLayout,
) {
  assert_command_succeeded(
    await run_sandbox_command(sandbox, sandbox_workspace_link_script(run_id, volume_root, layout), {
      timeoutMs: 60_000,
    }),
    'Workspace link into sandbox',
  );
}

async function read_sandbox_user_identity(sandbox: E2bSandbox) {
  const result = await run_sandbox_command(sandbox, `printf '%s:%s' "$(id -u)" "$(id -g)"`, {
    timeoutMs: 10_000,
  });
  assert_command_succeeded(result, 'E2B runtime user lookup');
  const identity = result.stdout.trim();
  if (!/^\d+:\d+$/u.test(identity)) {
    throw new Error('Could not read the E2B sandbox user identity.');
  }
  return identity;
}
