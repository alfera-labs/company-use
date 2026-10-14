import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env, type SessionEnv } from '@agent-core/environment';
import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import { memory_root_open_slugs_key } from '@runtime-platform/storage/memory_root';
import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, describe, expect, it } from 'vitest';

const created_directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    created_directories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function create_sandbox_directories() {
  const base = await mkdtemp(path.join(tmpdir(), 'zq-test-memory-root-'));
  created_directories.push(base);
  const workspace = path.join(base, 'workspace');
  const memory_root = path.join(base, 'memory');
  await mkdir(workspace);
  await mkdir(path.join(memory_root, 'secret'), { recursive: true });
  await writeFile(path.join(memory_root, 'secret', 'plan.md'), 'closed scope text\n');
  return { workspace, memory_root };
}

async function create_memory_environment(open_slugs: unknown, keep_closed_folder = true) {
  const directories = await create_sandbox_directories();
  if (!keep_closed_folder)
    await rm(path.join(directories.memory_root, 'secret'), { recursive: true });
  const environment = create_local_session_env({
    workspace_root: directories.workspace,
    working_directory: directories.workspace,
    memory_root_directory: directories.memory_root,
    metadata: { [memory_root_open_slugs_key]: open_slugs },
  });
  return { environment, ...directories };
}

async function run_tool(tool_name: string, input: unknown, environment: SessionEnv) {
  const tool = find_workspace_tool(tool_name);
  if (!tool) throw new Error(`${tool_name} is not registered.`);
  const result = await tool.execute(
    input as never,
    { environment, run_key: 'zq-test-run' } as never,
  );
  if (!result.ok) throw new Error(result.error_message);
  return result;
}

async function error_of(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the tool to refuse the path.');
}

const tool_calls_for = (memory_path: string) =>
  [
    ['workspace-write_file', { path: `${memory_path}/a.md`, content: 'x' }],
    ['workspace-edit_file', { path: `${memory_path}/plan.md`, old_text: 'a', new_text: 'b' }],
    ['workspace-read_file', { path: `${memory_path}/plan.md` }],
    ['workspace-list_files', { path: memory_path }],
    ['workspace-grep', { pattern: 'text', path: memory_path }],
    ['workspace-glob', { pattern: `${memory_path}/*.md` }],
    ['workspace-run_command', { command: 'ls', cwd: memory_path }],
    ['workspace-run_command', { command: 'true', writable_paths: [memory_path] }],
  ] as const;

describe('the /memory path class through the workspace tools', () => {
  it('writes, edits, reads, lists, greps, globs and runs inside an open scope folder', async () => {
    const { environment, memory_root, workspace } = await create_memory_environment(['demo']);

    const written = await run_tool(
      'workspace-write_file',
      { path: '/memory/demo/notes/a.md', content: 'alpha\n' },
      environment,
    );
    await run_tool(
      'workspace-edit_file',
      { path: '/memory/demo/notes/a.md', old_text: 'alpha', new_text: 'beta' },
      environment,
    );
    const read = await run_tool(
      'workspace-read_file',
      { path: '/memory/demo/notes/a.md' },
      environment,
    );
    const listed = await run_tool(
      'workspace-list_files',
      { path: '/memory/demo', recursive: true },
      environment,
    );
    const grepped = await run_tool(
      'workspace-grep',
      { pattern: 'beta', path: '/memory/demo' },
      environment,
    );
    const globbed = await run_tool(
      'workspace-glob',
      { pattern: '/memory/demo/**/*.md' },
      environment,
    );
    const command = await run_tool(
      'workspace-run_command',
      {
        command: 'cat',
        args: ['notes/a.md'],
        cwd: '/memory/demo',
        writable_paths: ['/memory/demo/notes'],
      },
      environment,
    );

    expect(await readFile(path.join(memory_root, 'demo', 'notes', 'a.md'), 'utf8')).toBe('beta\n');
    expect(existsSync(path.join(workspace, 'memory'))).toBe(false);
    expect(written.content_text).toBe('Wrote /memory/demo/notes/a.md');
    expect(read.content_text).toContain('beta');
    expect(listed.content_json).toEqual([
      { path: '/memory/demo/notes', name: 'notes', kind: 'directory' },
      { path: '/memory/demo/notes/a.md', name: 'a.md', kind: 'file' },
    ]);
    expect(grepped.content_json).toEqual([
      { path: '/memory/demo/notes/a.md', line: 1, text: 'beta' },
    ]);
    expect(globbed.content_json).toEqual(['/memory/demo/notes/a.md']);
    expect(command.content_text).toContain('beta');
  });

  it('gives a closed scope and a missing scope byte-identical errors in every tool', async () => {
    const closed = await create_memory_environment(['demo'], true);
    const missing = await create_memory_environment(['demo'], false);

    for (const [tool_name, input] of tool_calls_for('/memory/secret')) {
      const closed_error = await error_of(run_tool(tool_name, input, closed.environment));
      const missing_error = await error_of(run_tool(tool_name, input, missing.environment));
      expect(closed_error).toMatch(/^Path escapes workspace: \/memory\/secret/u);
      expect(closed_error).toBe(missing_error);
    }
    expect(await readFile(path.join(closed.memory_root, 'secret', 'plan.md'), 'utf8')).toBe(
      'closed scope text\n',
    );
  });

  it('refuses the memory root itself, climbs between scopes and climbs out', async () => {
    const { environment } = await create_memory_environment(['demo']);

    for (const refused_path of [
      '/memory',
      '/memory/',
      '/memory/demo/../secret/plan.md',
      '/memory/../etc/passwd',
    ]) {
      expect(
        await error_of(run_tool('workspace-read_file', { path: refused_path }, environment)),
      ).toMatch(/^Path escapes workspace:/u);
    }
    expect(
      await error_of(run_tool('workspace-glob', { pattern: '/memory/*/plan.md' }, environment)),
    ).toMatch(/^Path escapes workspace:/u);
  });

  it('opens nothing when the run carries no slug set or a malformed one', async () => {
    for (const open_slugs of [undefined, 'demo', [42]]) {
      const { environment, memory_root } = await create_memory_environment(open_slugs);
      const message = await error_of(
        run_tool('workspace-write_file', { path: '/memory/demo/a.md', content: 'x' }, environment),
      );
      expect(message).toMatch(/^Path escapes workspace: \/memory\/demo\/a\.md/u);
      expect(existsSync(path.join(memory_root, 'demo'))).toBe(false);
    }
  });

  it('keeps workspace paths on the workspace', async () => {
    const { environment, workspace, memory_root } = await create_memory_environment(['demo']);

    await run_tool(
      'workspace-write_file',
      { path: '/workspace/people/ada.md', content: 'ada' },
      environment,
    );
    await run_tool(
      'workspace-write_file',
      { path: 'memory/demo/a.md', content: 'not the memory root' },
      environment,
    );

    expect(await readFile(path.join(workspace, 'people', 'ada.md'), 'utf8')).toBe('ada');
    expect(await readFile(path.join(workspace, 'memory', 'demo', 'a.md'), 'utf8')).toBe(
      'not the memory root',
    );
    expect(existsSync(path.join(memory_root, 'demo'))).toBe(false);
  });
});

describe('generate_agent_visible_path for the memory root', () => {
  it('shows a memory path as itself in both path styles, not under /workspace', async () => {
    const { environment } = await create_memory_environment(['demo']);
    const e2b_style: SessionEnv = { env_key: 'zq-test', env_kind: 'remote_sandbox' };

    expect(generate_agent_visible_path(e2b_style, '/memory/demo/a.md')).toBe('/memory/demo/a.md');
    expect(generate_agent_visible_path(environment, '/memory/demo/a.md')).toBe('/memory/demo/a.md');
    expect(generate_agent_visible_path(e2b_style, 'people/ada.md')).toBe(
      '/workspace/people/ada.md',
    );
  });
});
