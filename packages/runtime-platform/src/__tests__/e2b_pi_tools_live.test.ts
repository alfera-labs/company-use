import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import {
  mark_coding_workspace_idle,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

const has_e2b_key = Boolean(process.env.E2B_API_KEY);

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

function generate_png(width: number, height: number) {
  const generate_chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const chunk = Buffer.alloc(typed.length + 8);
    chunk.writeUInt32BE(data.length, 0);
    typed.copy(chunk, 4);
    chunk.writeUInt32BE(calculate_crc(typed), typed.length + 4);
    return chunk;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const pixels = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) pixels[row * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    generate_chunk('IHDR', header),
    generate_chunk('IDAT', deflateSync(pixels)),
    generate_chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe.runIf(has_e2b_key)('pi-backed workspace tools on a live e2b sandbox', () => {
  it('resizes an oversized image, pages a long file, and searches from inside the sandbox', async () => {
    const workspace_base_path = await mkdtemp(path.join(tmpdir(), 'coworker-e2b-pi-'));
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Live E2B pi tools test',
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    const workspace = await open_or_create_coding_workspace(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      run_id: run.run_id,
      provider: 'e2b',
      workspace_base_path,
      actor_id: bootstrap.user_id,
    });

    try {
      const tools = create_runtime_tool_definitions(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        agent_id: bootstrap.agent_id,
        runtime_environment_id: workspace.runtime_environment_id,
        environment: workspace.environment,
        actor_id: bootstrap.user_id,
      });
      const tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
      const context = { run_key: run.run_id, session_key: session.session_id, metadata: {} };

      await workspace.environment.write_bytes?.(
        'repo/page.png',
        new Blob([new Uint8Array(generate_png(3000, 1688))]).stream(),
      );

      const viewed = await tool_by_name
        .get('workspace-view_image')
        ?.execute?.({ path: 'page.png' }, context);
      expect(viewed).toMatchObject({ ok: true });

      const content = (viewed as { content?: Array<{ type: string; mime_type?: string }> }).content;
      expect(content?.some((part) => part.type === 'image')).toBe(true);
      expect((viewed as { content_text?: string }).content_text ?? '').toContain('3000x1688');

      const lines = Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`).join('\n');
      await tool_by_name
        .get('workspace-write_file')
        ?.execute?.({ path: 'big.txt', content: lines }, context);

      const first_page = await tool_by_name
        .get('workspace-read_file')
        ?.execute?.({ path: 'big.txt' }, context);
      const first_text = (first_page as { content_text?: string }).content_text ?? '';
      expect(first_text).toContain('line 2000');
      expect(first_text).not.toContain('line 2001');
      expect(first_text).toContain('Use offset=2001 to continue.');

      const second_page = await tool_by_name
        .get('workspace-read_file')
        ?.execute?.({ path: 'big.txt', offset: 2_001, limit: 3 }, context);
      expect((second_page as { content_text?: string }).content_text).toContain(
        'line 2001\nline 2002\nline 2003',
      );

      const found = await tool_by_name
        .get('workspace-grep')
        ?.execute?.({ pattern: 'line 4242', path: '.' }, context);
      expect(found).toMatchObject({ ok: true });
      const matches = (found as { content_json?: Array<{ path: string; line: number }> })
        .content_json;
      expect(matches?.length).toBeGreaterThan(0);
      for (const match of matches ?? []) {
        expect(match.line).toBeGreaterThan(0);
        expect(match.path).not.toContain('binary file matches');
      }
    } finally {
      await mark_coding_workspace_idle(db, {
        workspace_id: bootstrap.workspace_id,
        runtime_environment_id: workspace.runtime_environment_id,
        actor_id: bootstrap.user_id,
      }).catch(() => undefined);
      await rm(workspace_base_path, { recursive: true, force: true });
    }
  }, 300_000);
});
