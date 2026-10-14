import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment';
import { memory_root_open_slugs_key } from '@agent-core/environment/memory_root_path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function with_workspace<T>(test: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-core-env-'));
  try {
    return await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('create_local_session_env', () => {
  it('supports workspace scoped read, write, edit, list, grep, glob, and exec', async () => {
    await with_workspace(async (workspace) => {
      const env = create_local_session_env({ working_directory: workspace });
      const real_workspace = await realpath(workspace);

      await env.write?.('src/example.txt', 'hello core\nhello runtime\n');
      expect(await env.read?.('src/example.txt')).toBe('hello core\nhello runtime\n');

      await expect(
        env.edit?.({ path: 'src/example.txt', old_text: 'hello', new_text: 'hi' }),
      ).resolves.toEqual({
        replacements: 1,
      });
      expect(await env.read?.('src/example.txt')).toBe('hi core\nhello runtime\n');

      await expect(env.list?.({ path: '.', recursive: true, max_depth: 2 })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'src', kind: 'directory' }),
          expect.objectContaining({ path: 'src/example.txt', kind: 'file' }),
        ]),
      );

      await expect(env.grep?.({ pattern: 'runtime', path: 'src' })).resolves.toEqual([
        { path: 'src/example.txt', line: 2, text: 'hello runtime' },
      ]);
      await expect(env.glob?.({ pattern: '**/*.txt' })).resolves.toEqual(['src/example.txt']);
      await expect(env.exec?.({ command: 'bash', args: ['-c', 'pwd'] })).resolves.toMatchObject({
        exit_code: 0,
        stdout: `${real_workspace}\n`,
      });
    });
  });

  it('supports a /workspace alias and does not leak host secrets into commands', async () => {
    await with_workspace(async (workspace) => {
      vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
      vi.stubEnv('DATABASE_URL', 'postgres://secret');
      await mkdir(path.join(workspace, 'repo'), { recursive: true });
      const real_workspace = await realpath(workspace);
      const env = create_local_session_env({
        workspace_root: workspace,
        working_directory: path.join(workspace, 'repo'),
      });

      await env.write?.('/workspace/artifacts/todo.txt', 'buy milk');
      expect(await env.read?.('artifacts/todo.txt')).toBe('buy milk');

      const result = await env.exec?.({
        command: 'node',
        args: [
          '-e',
          [
            'process.stdout.write(JSON.stringify({',
            'openai: process.env.OPENAI_API_KEY ?? null,',
            'database: process.env.DATABASE_URL ?? null,',
            'cwd: process.cwd()',
            '}))',
          ].join(''),
        ],
      });
      expect(JSON.parse(result?.stdout ?? '{}')).toEqual({
        openai: null,
        database: null,
        cwd: path.join(real_workspace, 'repo'),
      });
    });
  });

  it('refuses to read a binary file as text', async () => {
    await with_workspace(async (workspace) => {
      const env = create_local_session_env({ working_directory: workspace });
      await writeFile(
        path.join(workspace, 'sheet.xlsx'),
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41]),
      );

      await expect(env.read?.('sheet.xlsx')).rejects.toThrow(/binary file/);
    });
  });

  it('rejects direct and symlinked paths outside the workspace', async () => {
    await with_workspace(async (workspace) => {
      const env = create_local_session_env({ working_directory: workspace });
      const outside = path.join(tmpdir(), `agent-core-outside-${Date.now()}.txt`);
      await writeFile(outside, 'outside', 'utf8');
      await symlink(outside, path.join(workspace, 'escape.txt'));

      await expect(env.read?.('../outside.txt')).rejects.toThrow('Path escapes workspace');
      await expect(env.read?.('escape.txt')).rejects.toThrow(/(Path|Symlink) escapes workspace/);

      await rm(outside, { force: true });
    });
  });
});

describe('create_local_session_env memory root paths', () => {
  it('reads and writes an open scope slug under /memory, and closes the slug off when it is not open', async () => {
    await with_workspace(async (workspace) => {
      const memory_root = await mkdtemp(path.join(tmpdir(), 'agent-core-memory-'));
      try {
        const env = create_local_session_env({
          working_directory: workspace,
          memory_root_directory: memory_root,
          metadata: { [memory_root_open_slugs_key]: ['me-person-user-1'] },
        });

        await env.write?.('/memory/me-person-user-1/note.md', 'remember this\n');
        expect(await env.read?.('/memory/me-person-user-1/note.md')).toBe('remember this\n');

        await expect(env.read?.('/memory/closed-scope/note.md')).rejects.toThrow(
          'Path escapes workspace',
        );
        await expect(env.read?.('/memory')).rejects.toThrow('Path escapes workspace');
      } finally {
        await rm(memory_root, { recursive: true, force: true });
      }
    });
  });

  it('refuses every /memory path when no memory root directory is configured', async () => {
    await with_workspace(async (workspace) => {
      const env = create_local_session_env({
        working_directory: workspace,
        metadata: { [memory_root_open_slugs_key]: ['me-person-user-1'] },
      });

      await expect(env.read?.('/memory/me-person-user-1/note.md')).rejects.toThrow(
        'Path escapes workspace',
      );
    });
  });
});

describe('a session scratch folder backing tmp/', () => {
  async function with_shared_workspace_and_two_scratches<T>(
    test: (folders: { workspace: string; first_scratch: string; second_scratch: string }) => T,
  ) {
    return with_workspace(async (base) => {
      const folders = {
        workspace: path.join(base, 'shared'),
        first_scratch: path.join(base, 'first'),
        second_scratch: path.join(base, 'second'),
      };
      await Promise.all(Object.values(folders).map((folder) => mkdir(folder, { recursive: true })));
      await mkdir(path.join(folders.workspace, 'tmp'));
      return test(folders);
    });
  }

  it('keeps tmp/ apart for two sessions that share every other folder', async () => {
    await with_shared_workspace_and_two_scratches(async (folders) => {
      const first = create_local_session_env({
        working_directory: folders.workspace,
        scratch_root: folders.first_scratch,
      });
      const second = create_local_session_env({
        working_directory: folders.workspace,
        scratch_root: folders.second_scratch,
      });

      await first.write?.('files/report.md', 'shared');
      await first.write?.('/workspace/tmp/message.md', 'first session only');

      expect(await second.read?.('files/report.md')).toBe('shared');
      await expect(second.read?.('tmp/message.md')).rejects.toThrow(/ENOENT/);
      expect(await first.read?.('tmp/message.md')).toBe('first session only');
      expect(await readFile(path.join(folders.first_scratch, 'message.md'), 'utf8')).toBe(
        'first session only',
      );
      await expect(readdir(path.join(folders.workspace, 'tmp'))).resolves.toEqual([]);
    });
  });

  it('lists, globs and greps scratch files under their tmp/ path', async () => {
    await with_shared_workspace_and_two_scratches(async (folders) => {
      const env = create_local_session_env({
        working_directory: folders.workspace,
        scratch_root: folders.first_scratch,
      });
      await env.write?.('tmp/attachments/a1/rows.csv', 'needle,1\n');

      await expect(env.list?.({ path: '.', recursive: true })).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'tmp', kind: 'directory' }),
          expect.objectContaining({ path: 'tmp/attachments/a1/rows.csv', kind: 'file' }),
        ]),
      );
      await expect(env.list?.({ path: 'tmp/attachments' })).resolves.toEqual([
        { path: 'tmp/attachments/a1', name: 'a1', kind: 'directory' },
      ]);
      await expect(env.glob?.({ pattern: 'tmp/**/*.csv' })).resolves.toEqual([
        'tmp/attachments/a1/rows.csv',
      ]);
      await expect(env.grep?.({ pattern: 'needle' })).resolves.toEqual([
        { path: 'tmp/attachments/a1/rows.csv', line: 1, text: 'needle,1' },
      ]);
      await expect(env.stat?.('tmp/attachments/a1/rows.csv')).resolves.toEqual({
        kind: 'file',
        byte_size: 9,
      });
    });
  });

  it('rejects a scratch symlink that leaves both the workspace and the scratch', async () => {
    await with_shared_workspace_and_two_scratches(async (folders) => {
      const env = create_local_session_env({
        working_directory: folders.workspace,
        scratch_root: folders.first_scratch,
      });
      await writeFile(path.join(folders.second_scratch, 'secret.txt'), 'other session', 'utf8');
      await symlink(
        path.join(folders.second_scratch, 'secret.txt'),
        path.join(folders.first_scratch, 'escape.txt'),
      );

      await expect(env.read?.('tmp/escape.txt')).rejects.toThrow('Symlink escapes workspace');
      await expect(env.read?.('tmp/../../second/secret.txt')).rejects.toThrow(
        'Path escapes workspace',
      );
    });
  });
});
