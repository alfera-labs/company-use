import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { read_file_with_pi } from '@agent-core/coding/read_file_with_pi';
import { create_local_session_env } from '@agent-core/environment';
import { describe, expect, it } from 'vitest';

async function with_workspace<T>(test: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'pi-read-'));
  try {
    return await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function read(
  workspace: string,
  input: { workspace_path: string; offset?: number; limit?: number },
) {
  return read_file_with_pi(create_local_session_env({ working_directory: workspace }), {
    ...input,
    tool_call_id: 'call_1',
  });
}

function first_text(parts: Awaited<ReturnType<typeof read>>) {
  const part = parts.find((candidate) => candidate.type === 'text');
  return part?.type === 'text' ? part.text : '';
}

describe('read_file_with_pi', () => {
  it('reads a short file whole', async () => {
    await with_workspace(async (workspace) => {
      await writeFile(path.join(workspace, 'notes.txt'), 'line one\nline two\n');

      expect(first_text(await read(workspace, { workspace_path: 'notes.txt' }))).toBe(
        'line one\nline two\n',
      );
    });
  });

  it('bounds a long file and says how to continue', async () => {
    await with_workspace(async (workspace) => {
      const lines = Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`);
      await writeFile(path.join(workspace, 'big.txt'), lines.join('\n'));

      const text = first_text(await read(workspace, { workspace_path: 'big.txt' }));

      expect(text).toContain('line 2000');
      expect(text).not.toContain('line 2001');
      expect(text).toContain('[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]');
    });
  });

  it('continues from the offset the previous read reported', async () => {
    await with_workspace(async (workspace) => {
      const lines = Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`);
      await writeFile(path.join(workspace, 'big.txt'), lines.join('\n'));

      const text = first_text(
        await read(workspace, { workspace_path: 'big.txt', offset: 2_001, limit: 3 }),
      );

      expect(text).toContain('line 2001\nline 2002\nline 2003');
      expect(text).not.toContain('line 2000');
    });
  });

  it('reports a missing file as a failed read', async () => {
    await with_workspace(async (workspace) => {
      await expect(read(workspace, { workspace_path: 'nope.txt' })).rejects.toThrow();
    });
  });

  it('resolves nested workspace paths', async () => {
    await with_workspace(async (workspace) => {
      await rm(path.join(workspace, 'repo'), { recursive: true, force: true });
      await writeFile(path.join(workspace, 'top.txt'), 'at the root\n');

      expect(first_text(await read(workspace, { workspace_path: 'top.txt' }))).toBe(
        'at the root\n',
      );
    });
  });
});

describe('read_file_with_pi on a text-only environment', () => {
  const text_only_environment = {
    env_key: 'text-only',
    env_kind: 'custom' as const,
    read: async () => 'contents',
    stat: async () => ({ kind: 'file' as const, byte_size: 8 }),
  };

  it('falls back to the text reader instead of failing', async () => {
    const parts = await read_file_with_pi(text_only_environment, {
      workspace_path: 'notes.md',
      tool_call_id: 'call_1',
    });

    expect(first_text(parts)).toBe('contents');
  });

  it('reports no image, since a text read cannot return one intact', async () => {
    const parts = await read_file_with_pi(text_only_environment, {
      workspace_path: 'photo.png',
      tool_call_id: 'call_1',
    });

    expect(parts.every((part) => part.type === 'text')).toBe(true);
  });
});
