import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { create_built_in_tools } from '@agent-core/coding';
import { create_local_session_env } from '@agent-core/environment';
import type { RuntimeToolContext } from '@agent-core/tools';
import { describe, expect, it } from 'vitest';

function calculate_crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function generate_test_png(): Buffer {
  const generate_chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const chunk = Buffer.alloc(typed.length + 8);
    chunk.writeUInt32BE(data.length, 0);
    typed.copy(chunk, 4);
    chunk.writeUInt32BE(calculate_crc(typed), typed.length + 4);
    return chunk;
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    generate_chunk('IHDR', header),
    generate_chunk('IDAT', deflateSync(Buffer.from([0x00, 0x80]))),
    generate_chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function with_workspace<T>(test: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-core-tools-'));
  try {
    return await test(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe('create_built_in_tools', () => {
  it('exposes executable coding tools backed by the session environment', async () => {
    await with_workspace(async (workspace) => {
      const tools = create_built_in_tools();
      expect(tools.map((tool) => tool.tool_name)).toEqual([
        'read',
        'bash',
        'edit',
        'write',
        'grep',
        'find',
        'ls',
      ]);

      const context: RuntimeToolContext = {
        run_key: 'run_test',
        environment: create_local_session_env({ working_directory: workspace }),
        metadata: {},
      };
      const by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));

      await expect(
        by_name.get('write')?.execute?.({ path: 'notes/todo.txt', content: 'ship core' }, context),
      ).resolves.toMatchObject({
        ok: true,
      });
      await expect(
        by_name.get('read')?.execute?.({ path: 'notes/todo.txt' }, context),
      ).resolves.toMatchObject({
        ok: true,
        content_text: 'ship core',
      });
      await expect(
        by_name
          .get('edit')
          ?.execute?.(
            { path: 'notes/todo.txt', edits: [{ oldText: 'ship', newText: 'test' }] },
            context,
          ),
      ).resolves.toMatchObject({
        ok: true,
        content_text: 'Successfully replaced 1 block(s) in notes/todo.txt.',
      });
      await expect(
        by_name.get('grep')?.execute?.({ pattern: 'test', path: 'notes' }, context),
      ).resolves.toMatchObject({
        ok: true,
        content_text: expect.stringContaining('test core'),
      });
      await expect(
        by_name.get('bash')?.execute?.({ command: 'cat notes/todo.txt' }, context),
      ).resolves.toMatchObject({
        ok: true,
        content_text: 'test core',
      });
    });
  });

  it('carries the image part of a pi read result through to the model', async () => {
    await with_workspace(async (workspace) => {
      await writeFile(path.join(workspace, 'page.png'), generate_test_png());
      const tool = create_built_in_tools().find((candidate) => candidate.tool_name === 'read');

      const result = await tool?.execute?.(
        { path: 'page.png' },
        {
          run_key: 'run_test',
          environment: create_local_session_env({ working_directory: workspace }),
          metadata: {},
        },
      );

      expect(result).toMatchObject({ ok: true });
      expect(result?.ok === true && result.content).toEqual([
        { type: 'text', text: expect.stringContaining('Read image file') },
        { type: 'image', data: expect.any(String), mime_type: 'image/png' },
      ]);
    });
  });

  it('returns a tool error when no session environment is available', async () => {
    const tool = create_built_in_tools().find((candidate) => candidate.tool_name === 'read');
    await expect(
      tool?.execute?.(
        { path: 'anything.txt' },
        {
          run_key: 'run_test',
          metadata: {},
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error_code: 'missing_environment',
    });
  });
});
