import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment/local_session_env';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { workspace_path_is_durable } from '@runtime-platform/storage/workspace_layouts';
import {
  append_workspace_activity,
  private_activity_folder,
} from '@runtime-platform/tools/workspace_activity_log';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const now = new Date('2026-10-02T09:00:00.000Z');
const secret_input = { path: 'notes/salary-review.md', content: 'zq-test private DM text' };
const workspace_roots: string[] = [];
const chat = { workspace_id: 'ws_zq_test', session_id: 'ses_zq_test' };
let object_storage = create_in_memory_object_storage();

beforeEach(() => {
  object_storage = create_in_memory_object_storage();
  set_memory_import_object_storage_for_tests(object_storage);
});

afterEach(async () => {
  set_memory_import_object_storage_for_tests(undefined);
  await Promise.all(workspace_roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function create_workspace(layout_version: number) {
  const root = await mkdtemp(path.join(tmpdir(), 'zq-test-activity-'));
  workspace_roots.push(root);
  const environment = create_local_session_env({
    working_directory: root,
    metadata: { workspace_layout_version: layout_version },
  });
  return { root, environment };
}

async function append_one_call(
  environment: ReturnType<typeof create_local_session_env>,
  metadata: Record<string, unknown>,
) {
  await append_workspace_activity(
    { environment, metadata, ...chat },
    {
      run_id: 'run_1',
      tool_name: 'workspace-write_file',
      ok: true,
      input: secret_input,
      result: {},
    },
    now,
  );
}

async function list_files(root: string, folder: string) {
  const entries = await readdir(path.join(root, folder), { recursive: true }).catch(() => []);
  return entries.map(String).filter((entry) => entry.endsWith('.jsonl'));
}

describe('a run narrower than the workspace', () => {
  it('writes no activity line to the shared volume', async () => {
    const { root, environment } = await create_workspace(2);
    await append_one_call(environment, { run_audience: 'narrow' });

    expect(await list_files(root, 'system')).toEqual([]);
    expect(await list_files(root, private_activity_folder)).toEqual([
      path.join('2026-10-02', 'run_1.jsonl'),
    ]);
  });

  it('keeps the line on sandbox scratch, which no other chat mounts', async () => {
    const { root, environment } = await create_workspace(2);
    await append_one_call(environment, { run_audience: 'narrow' });

    const line = await readFile(
      path.join(root, private_activity_folder, '2026-10-02', 'run_1.jsonl'),
      'utf8',
    );
    expect(JSON.parse(line).input).toContain('zq-test private DM text');
    expect(workspace_path_is_durable(`${private_activity_folder}/2026-10-02/run_1.jsonl`)).toBe(
      false,
    );
    expect(await list_files(root, 'system')).toEqual([]);
  });

  it('keeps a copy for its own chat only, outside the shared volume', async () => {
    const { environment } = await create_workspace(2);
    await append_one_call(environment, { run_audience: 'narrow' });

    const copies = [...object_storage.objects.keys()];
    expect(copies).toEqual([
      `workspace/${chat.workspace_id}/sessions/${chat.session_id}/scratch/2026-10-02/${private_activity_folder}/2026-10-02/run_1.jsonl`,
    ]);
  });

  it('is assumed when the run did not say who reads it', async () => {
    const { root, environment } = await create_workspace(2);
    await append_one_call(environment, {});

    expect(await list_files(root, 'system')).toEqual([]);
    expect(await list_files(root, private_activity_folder)).toHaveLength(1);
  });
});

describe('a workspace-wide run', () => {
  it('still writes its activity line to the shared volume', async () => {
    const { root, environment } = await create_workspace(2);
    await append_one_call(environment, { run_audience: 'workspace' });

    expect(await list_files(root, 'system/activity')).toEqual([
      path.join('2026-10-02', 'run_1.jsonl'),
    ]);
    expect(workspace_path_is_durable('system/activity/2026-10-02/run_1.jsonl')).toBe(true);
    expect(await list_files(root, private_activity_folder)).toEqual([]);
    expect(object_storage.objects.size).toBe(0);
  });
});

describe('a workspace on an older layout', () => {
  it.each([
    'workspace',
    'narrow',
  ])('is given no activity record at all (%s run)', async (run_audience) => {
    const { root, environment } = await create_workspace(1);
    await append_one_call(environment, { run_audience });

    expect(await list_files(root, '.')).toEqual([]);
  });
});
