import {
  archil_checkin,
  archil_checkout,
  mount_archil_volume,
  prepare_archil_volume,
} from '@runtime-platform/orchestrator/e2b_volume';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import { CommandExitError, type Sandbox } from 'e2b';
import { describe, expect, it } from 'vitest';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

const volume: OpenVolume = {
  volume_id: 'vol_setup_test',
  workspace_mount_key: 'workspace:ws_test:ses_test',
  provider: 'archil',
  workspace_layout_version: 2,
  provider_volume_id: 'dsk_setup_test',
  provider_region: 'aws-us-west-2',
  root_path: '/mnt/coworker',
  mount_token: 'test-token',
};

type FakeResponse = { exit_code?: number; stdout?: string; stderr?: string };

function create_fake_sandbox(route: (command: string) => FakeResponse) {
  const commands_run: string[] = [];
  const sandbox = {
    commands: {
      run: async (command: string) => {
        commands_run.push(command);
        const routed = route(command);
        const response =
          command.startsWith("'mountpoint'") && routed.exit_code === undefined
            ? { exit_code: 1 }
            : routed;
        const result = {
          exitCode: response.exit_code ?? 0,
          stdout: response.stdout ?? '',
          stderr: response.stderr ?? '',
          error: undefined,
        };
        if (result.exitCode !== 0) throw new CommandExitError(result as never);
        return result;
      },
    },
  } as unknown as E2bSandbox;
  return { sandbox, commands_run };
}

const user_identity = (command: string) => command.includes('id -u');
const layout_probe = (command: string) =>
  command.includes("stat -c '%u:%g'") && command.includes('system/layout.json');
const root_checkout_command = (command: string) =>
  command.startsWith("'archil' 'checkout' '/mnt/coworker'") &&
  !command.includes('/mnt/coworker/agents/');
const browser_state_checkout_command = (command: string) =>
  command.startsWith("'archil' 'checkout' '/mnt/coworker/agents/ag_test/workspace/system/browser/");
const checkout_command = root_checkout_command;

describe('prepare_archil_volume', () => {
  it('never claims the volume root when the layout is already complete', async () => {
    const { sandbox, commands_run } = create_fake_sandbox((command) => {
      if (user_identity(command)) return { stdout: '1000:1000' };
      return {};
    });

    await prepare_archil_volume(sandbox, volume, { run_id: 'run_complete', agent_id: 'ag_test' });

    expect(commands_run.some(checkout_command)).toBe(false);
    expect(commands_run.some((command) => command.includes('xargs'))).toBe(false);
    expect(commands_run.some((command) => command.includes('mount --bind'))).toBe(true);
  });

  it('claims both browser-state directories for the run so autosaves can persist', async () => {
    const { sandbox, commands_run } = create_fake_sandbox((command) => {
      if (user_identity(command)) return { stdout: '1000:1000' };
      return {};
    });

    await prepare_archil_volume(sandbox, volume, { run_id: 'run_complete', agent_id: 'ag_test' });

    const browser_state_claims = commands_run.filter(browser_state_checkout_command);
    expect(browser_state_claims).toHaveLength(2);
    expect(browser_state_claims.join(' ')).toContain('browser/sessions');
    expect(browser_state_claims.join(' ')).toContain('browser/auth');
  });

  it('starts the run even when a peer session holds the browser-state claim', async () => {
    const { sandbox, commands_run } = create_fake_sandbox((command) => {
      if (user_identity(command)) return { stdout: '1000:1000' };
      if (browser_state_checkout_command(command)) {
        return { exit_code: 1, stderr: 'checkout failed: unrelated error' };
      }
      return {};
    });

    await expect(
      prepare_archil_volume(sandbox, volume, { run_id: 'run_complete', agent_id: 'ag_test' }),
    ).resolves.toBeUndefined();
    expect(commands_run.some((command) => command.includes('mount --bind'))).toBe(true);
  });

  it('claims, initializes, and releases the root when the layout is missing', async () => {
    const { sandbox, commands_run } = create_fake_sandbox((command) => {
      if (user_identity(command)) return { stdout: '1000:1000' };
      if (layout_probe(command)) return { exit_code: 1 };
      return {};
    });

    await prepare_archil_volume(sandbox, volume, { run_id: 'run_first', agent_id: 'ag_test' });

    const checkout = commands_run.findIndex(checkout_command);
    const ownership = commands_run.findIndex((command) => command.includes('xargs'));
    const initialization = commands_run.findIndex((command) =>
      command.includes("mkdir -p -- '/mnt/coworker/agents/ag_test/workspace/people'"),
    );
    const checkin = commands_run.findIndex((command) => command.startsWith("'archil' 'checkin'"));
    const link = commands_run.findIndex((command) => command.includes('mount --bind'));
    expect(checkout).toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(ownership);
    expect(ownership).toBeLessThan(initialization);
    expect(initialization).toBeLessThan(checkin);
    expect(checkin).toBeLessThan(link);
  });
});

describe('archil_checkout', () => {
  const conflict_stderr =
    "We were unable to checkout the inode at '/mnt/coworker' because another client has an outstanding delegation which conflicts with the checkout.";

  it('waits for a busy peer and succeeds when the claim is released', async () => {
    let attempts = 0;
    const { sandbox } = create_fake_sandbox(() => {
      attempts += 1;
      return attempts === 1 ? { exit_code: 1, stderr: conflict_stderr } : {};
    });

    await archil_checkout(sandbox, '/mnt/coworker', { attempts: 3, delay_ms: 1 });

    expect(attempts).toBe(2);
  });

  it("fails immediately on a non-conflict error, with the command's own explanation", async () => {
    let attempts = 0;
    const { sandbox } = create_fake_sandbox(() => {
      attempts += 1;
      return { exit_code: 1, stderr: 'permission denied' };
    });

    await expect(
      archil_checkout(sandbox, '/mnt/coworker', { attempts: 5, delay_ms: 1 }),
    ).rejects.toThrow(/permission denied/u);
    expect(attempts).toBe(1);
  });

  it('gives up after the last attempt and reports the conflict', async () => {
    let attempts = 0;
    const { sandbox } = create_fake_sandbox(() => {
      attempts += 1;
      return { exit_code: 1, stderr: conflict_stderr };
    });

    await expect(
      archil_checkout(sandbox, '/mnt/coworker', { attempts: 2, delay_ms: 1 }),
    ).rejects.toThrow(/outstanding delegation/u);
    expect(attempts).toBe(2);
  });

  it('passes --yes with --force so the reclaim is not stopped by a confirmation prompt', async () => {
    const { sandbox, commands_run } = create_fake_sandbox(() => ({
      exit_code: 1,
      stderr: conflict_stderr,
    }));

    await expect(
      archil_checkout(sandbox, '/mnt/coworker', {
        attempts: 2,
        delay_ms: 1,
        reclaim_on_last_attempt: true,
      }),
    ).rejects.toThrow(/outstanding delegation/u);

    const [polite_attempt, reclaim_attempt] = commands_run;
    expect(polite_attempt).not.toContain('--force');
    expect(reclaim_attempt).toContain("'--force'");
    expect(reclaim_attempt).toContain("'--yes'");
  });

  it('never reclaims while polite retries remain', async () => {
    const { sandbox, commands_run } = create_fake_sandbox(() => ({
      exit_code: 1,
      stderr: conflict_stderr,
    }));

    await expect(
      archil_checkout(sandbox, '/mnt/coworker', {
        attempts: 4,
        delay_ms: 1,
        reclaim_on_last_attempt: true,
      }),
    ).rejects.toThrow(/outstanding delegation/u);

    expect(commands_run.filter((command) => command.includes('--force'))).toHaveLength(1);
  });
});

describe('archil_checkin', () => {
  it("surfaces the provider's failure explanation", async () => {
    const { sandbox } = create_fake_sandbox(() => ({
      exit_code: 1,
      stderr: 'delegation was not released',
    }));

    await expect(
      archil_checkin(sandbox, '/mnt/coworker/workspace/repo/report.xlsx'),
    ).rejects.toThrow(/delegation was not released/u);
  });
});

describe('mount_archil_volume', () => {
  it("surfaces the mount command's stderr instead of a bare exit status", async () => {
    const { sandbox } = create_fake_sandbox((command) => {
      if (command.startsWith("'archil' 'mount'")) {
        return { exit_code: 1, stderr: 'authentication failed: bad mount token' };
      }
      return {};
    });

    await expect(mount_archil_volume(sandbox, volume)).rejects.toThrow(/bad mount token/u);
  });
});

it('reclaims the disk root on the last attempt when a dead client still holds it', async () => {
  const conflict =
    "We were unable to checkout the inode at '/mnt/coworker' because another client has an outstanding delegation which conflicts with the checkout.";
  const { sandbox, commands_run } = create_fake_sandbox((command) => {
    if (user_identity(command)) return { stdout: '1000:1000' };
    if (layout_probe(command)) return { exit_code: 1 };
    if (command.startsWith("'archil' 'checkout' '/mnt/coworker'")) {
      return { exit_code: 1, stderr: conflict };
    }
    return {};
  });

  await prepare_archil_volume(sandbox, volume, { run_id: 'run_stale', agent_id: 'ag_test' });

  expect(commands_run).toContain("'archil' 'checkout' '--force' '--yes' '/mnt/coworker'");
  const polite = commands_run.filter((command) =>
    command.startsWith("'archil' 'checkout' '/mnt/coworker'"),
  );
  expect(polite.length).toBe(7);
});
