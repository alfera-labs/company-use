import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { restore_chat_scratch_files_hook } from '@runtime-platform/orchestrator/chat_scratch_run_hooks';
import { run_hook_sources } from '@runtime-platform/orchestrator/open_run_hooks';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { workspace_path_is_durable } from '@runtime-platform/storage/workspace_layouts';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { settle_run_background_writes } from '@runtime-platform/tools/run_background_writes';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
});

afterEach(() => {
  set_memory_import_object_storage_for_tests(undefined);
});

type Sandbox = SessionEnv & { scratch: Map<string, string> };

function open_sandbox(volume: Map<string, string>, stdout: string): Sandbox {
  const scratch = new Map<string, string>();
  const disk_for = (file_path: string) => (workspace_path_is_durable(file_path) ? volume : scratch);
  return {
    scratch,
    env_key: `sandbox_${crypto.randomUUID()}`,
    env_kind: 'remote_sandbox',
    metadata: { workspace_layout_version: 2 },
    exec: async () => ({ exit_code: 0, stdout, stderr: '' }),
    write: async (file_path, contents) => {
      disk_for(file_path).set(file_path, contents);
    },
    read: async (file_path) => {
      const contents = disk_for(file_path).get(file_path);
      if (contents === undefined) throw new Error(`ENOENT: ${file_path}`);
      return contents;
    },
  };
}

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const open_chat = async () => {
    const session = await create_session(db, {
      workspace_id: actor.workspace_id,
      agent_id: actor.agent_id,
      actor_id: actor.user_id,
    });
    const run = await create_run(db, {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      agent_id: actor.agent_id,
      trigger_type: 'user_message',
      actor_id: actor.user_id,
    });
    return {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: actor.user_id,
    };
  };
  return { db, open_chat };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;
type Chat = Awaited<ReturnType<Fixture['open_chat']>>;

async function run_a_large_command(
  fixture: Fixture,
  chat: Chat,
  environment: SessionEnv,
  metadata: Record<string, unknown>,
) {
  const tool = create_runtime_tool_definitions(fixture.db, { ...chat, environment }).find(
    (definition) => definition.tool_name === 'workspace-run_command',
  );
  if (!tool?.execute) throw new Error('workspace-run_command is not offered.');
  const result = await tool.execute(
    { command: 'cat', args: ['orders.csv'] },
    {
      run_key: chat.run_id,
      session_key: chat.session_id,
      tool_call_id: 'model_cat',
      metadata,
      environment,
    },
  );
  await settle_run_background_writes(chat.run_id);
  expect(result).toMatchObject({ ok: true });
  return String((result as Extract<RuntimeToolResult, { ok: true }>).metadata?.full_output_path);
}

async function prepare_new_sandbox(chat: Chat, sandbox: SessionEnv) {
  const workspace: OpenedCodingWorkspace = {
    runtime_environment_id: 'renv_zq_test',
    workspace_id: chat.workspace_id,
    workspace_mount_key: `workspace:${chat.workspace_id}:${chat.session_id}`,
    provider: 'e2b',
    host_workspace_root: '/workspace',
    environment: sandbox,
    close_token: {},
  };
  const hook = restore_chat_scratch_files_hook(chat);
  await expect(hook.run(workspace, new AbortController().signal)).resolves.toEqual({
    outcome: 'prepared',
  });
}

function activity_paths(files: Map<string, string>) {
  return [...files.keys()].filter((file_path) => file_path.endsWith('.jsonl'));
}

const narrow_runs = [
  ['a private chat', { run_audience: 'narrow' }],
  ['a run that does not name its audience', {}],
] as const;

describe('a narrow run resumed in a new sandbox', () => {
  it.each(
    narrow_runs,
  )('reopens the large result and the activity log of %s', async (_, metadata) => {
    const fixture = await create_fixture();
    const chat = await fixture.open_chat();
    const volume = new Map<string, string>();
    const first_sandbox = open_sandbox(volume, 'zq-test-order-row\n'.repeat(4_000));
    const saved_path = await run_a_large_command(fixture, chat, first_sandbox, metadata);

    const resumed_sandbox = open_sandbox(volume, '');
    await prepare_new_sandbox(chat, resumed_sandbox);

    await expect(resumed_sandbox.read?.(saved_path)).resolves.toContain('zq-test-order-row');
    const [activity_path] = activity_paths(resumed_sandbox.scratch);
    const activity_line = await resumed_sandbox.read?.(String(activity_path));
    expect(JSON.parse(String(activity_line)).output_path).toBe(saved_path);
  });

  it.each(narrow_runs)('leaves nothing on the shared volume for %s', async (_, metadata) => {
    const fixture = await create_fixture();
    const chat = await fixture.open_chat();
    const volume = new Map<string, string>();
    await run_a_large_command(fixture, chat, open_sandbox(volume, 'x'.repeat(80_000)), metadata);

    const resumed_sandbox = open_sandbox(volume, '');
    await prepare_new_sandbox(chat, resumed_sandbox);

    expect([...volume.keys()]).toEqual([]);
  });

  it('gives nothing to a new sandbox of another chat in the same workspace', async () => {
    const fixture = await create_fixture();
    const private_chat = await fixture.open_chat();
    const other_chat = await fixture.open_chat();
    const volume = new Map<string, string>();
    await run_a_large_command(fixture, private_chat, open_sandbox(volume, 'y'.repeat(80_000)), {
      run_audience: 'narrow',
    });

    const other_sandbox = open_sandbox(volume, '');
    await prepare_new_sandbox(other_chat, other_sandbox);

    expect([...other_sandbox.scratch.keys()]).toEqual([]);
    expect([...volume.keys()]).toEqual([]);
  });

  it('writes nothing again into a sandbox that already holds the files', async () => {
    const fixture = await create_fixture();
    const chat = await fixture.open_chat();
    const sandbox = open_sandbox(new Map(), 'z'.repeat(80_000));
    await run_a_large_command(fixture, chat, sandbox, { run_audience: 'narrow' });
    const writes: string[] = [];
    const counted = { ...sandbox, write: async (file_path: string) => void writes.push(file_path) };

    await prepare_new_sandbox(chat, counted);

    expect(writes).toEqual([]);
  });
});

describe('a workspace-wide run resumed in a new sandbox', () => {
  it('reopens its large result and activity log from the shared volume', async () => {
    const fixture = await create_fixture();
    const chat = await fixture.open_chat();
    const volume = new Map<string, string>();
    const saved_path = await run_a_large_command(
      fixture,
      chat,
      open_sandbox(volume, 'zq-test-order-row\n'.repeat(4_000)),
      { run_audience: 'workspace' },
    );

    const resumed_sandbox = open_sandbox(volume, '');
    await prepare_new_sandbox(chat, resumed_sandbox);

    expect(saved_path.startsWith('system/tool-output/')).toBe(true);
    await expect(resumed_sandbox.read?.(saved_path)).resolves.toContain('zq-test-order-row');
    expect(activity_paths(volume)).toHaveLength(1);
    expect([...resumed_sandbox.scratch.keys()]).toEqual([]);
  });
});

describe('every run', () => {
  it('opens the hook that puts its chat scratch files back', () => {
    expect(run_hook_sources.map((source) => source.source_name)).toContain('chat_scratch_files');
  });
});
