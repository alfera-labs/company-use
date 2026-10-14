import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_runtime_environment,
  create_session,
  update_run_status,
  upsert_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { mark_coding_workspace_idle } from '@runtime-platform/orchestrator/workspace_runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const e2b_mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  SandboxNotFoundError: class SandboxNotFoundError extends Error {},
}));

vi.mock('e2b', async (import_original) => ({
  ...(await import_original<typeof import('e2b')>()),
  Sandbox: { connect: e2b_mocks.connect },
  SandboxNotFoundError: e2b_mocks.SandboxNotFoundError,
}));

const browser_state_root = '/mnt/coworker/agents/agt_close/workspace/system/browser';

function sandbox_whose_browser_state_is_claimed_elsewhere() {
  const commands: string[] = [];
  const run = vi.fn(async (command: string) => {
    commands.push(command);
    const conflict =
      command.includes("'archil' 'checkout' '/") && command.includes('/system/browser/');
    if (conflict) {
      return { exitCode: 1, stdout: '', stderr: 'another client has an outstanding delegation' };
    }
    if (command.includes('agent-browser')) {
      const saved = { success: true, data: { saveStatus: 'saved', saveError: null } };
      return { exitCode: 0, stdout: JSON.stringify(saved), stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const sandbox = { sandboxId: 'sbox_closing', commands: { run }, kill: vi.fn(), pause: vi.fn() };
  return { sandbox, commands };
}

async function create_closing_workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const actor_id = bootstrap.user_id;
  const workspace_id = bootstrap.workspace_id;
  const agent_id = bootstrap.agent_id;
  const session = await create_session(db, { workspace_id, agent_id, actor_id });
  const volume = await create_volume(db, {
    workspace_id,
    volume_provider: 'archil',
    workspace_layout_version: 2,
    volume_status: 'active',
    provider_volume_id: 'dsk_close',
    provider_region: 'aws-us-west-2',
    actor_id,
  });
  const workspace_mount_key = `workspace:${workspace_id}:${session.session_id}`;
  const environment = await create_runtime_environment(db, {
    workspace_id,
    session_id: session.session_id,
    agent_id,
    environment_provider: 'e2b',
    environment_status: 'running',
    provider_environment_id: 'sbox_closing',
    workspace_mount_key,
    root_path: '/work',
    environment_metadata: {
      volume_id: volume.volume_id,
      volume_provider: 'archil',
      volume_root_path: '/mnt/coworker',
      agent_workspace_path: 'agents/agt_close/workspace',
      workspace_layout_version: 2,
    },
    actor_id,
  });
  await upsert_sandbox_by_mount_key(db, {
    workspace_id,
    agent_id,
    session_id: session.session_id,
    runtime_environment_id: environment.runtime_environment_id,
    sandbox_provider: 'e2b',
    sandbox_status: 'running',
    provider_sandbox_id: 'sbox_closing',
    workspace_mount_key,
    root_path: '/work',
    working_directory: '/work/repo',
    actor_id,
  });
  const close = () =>
    mark_coding_workspace_idle(db, {
      workspace_id,
      runtime_environment_id: environment.runtime_environment_id,
      close_token: { provider_environment_id: 'sbox_closing' },
      actor_id,
    });
  return { db, workspace_id, agent_id, actor_id, close };
}

async function start_a_peer_run(workspace: Awaited<ReturnType<typeof create_closing_workspace>>) {
  const { db, workspace_id, agent_id, actor_id } = workspace;
  const peer_session = await create_session(db, { workspace_id, agent_id, actor_id });
  const peer_run = await create_run(db, {
    workspace_id,
    session_id: peer_session.session_id,
    agent_id,
    trigger_type: 'user_message',
    actor_id,
  });
  await update_run_status(db, { run_id: peer_run.run_id, run_status: 'running', actor_id });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function close_without_waiting_for_retry_delays(close: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  let settled = false;
  const closing = close().finally(() => {
    settled = true;
  });
  while (!settled) await vi.advanceTimersByTimeAsync(1_000);
  return closing;
}

describe('closing a sandbox while another run of the agent holds its browser state', () => {
  it('leaves the live peer its claim and closes without an error', async () => {
    const workspace = await create_closing_workspace();
    await start_a_peer_run(workspace);
    const { sandbox, commands } = sandbox_whose_browser_state_is_claimed_elsewhere();
    e2b_mocks.connect.mockResolvedValue(sandbox);

    await expect(workspace.close()).resolves.toMatchObject({ environment_status: 'idle' });

    expect(commands.join('\n')).not.toContain("'--force'");
    expect(commands).not.toContain("'agent-browser' '--json' 'close'");
    expect(commands).toContain("'archil' 'unmount' '/mnt/coworker'");
  });

  it('still reclaims a claim that no live run can be holding', async () => {
    const workspace = await create_closing_workspace();
    const { sandbox, commands } = sandbox_whose_browser_state_is_claimed_elsewhere();
    e2b_mocks.connect.mockResolvedValue(sandbox);

    await expect(close_without_waiting_for_retry_delays(workspace.close)).resolves.toMatchObject({
      environment_status: 'idle',
    });

    expect(commands).toContain(
      `'archil' 'checkout' '--force' '--yes' '${browser_state_root}/sessions'`,
    );
    expect(commands).toContain(
      `'archil' 'checkout' '--force' '--yes' '${browser_state_root}/auth'`,
    );
    expect(commands).toContain("'agent-browser' '--json' 'close'");
  });
});
