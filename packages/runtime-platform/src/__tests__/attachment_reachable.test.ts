import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_built_in_tools } from '@agent-core/coding/built_in_tools';
import { create_local_session_env } from '@agent-core/environment';
import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import { describe_hydrated_attachments } from '@runtime-platform/attachments/describe_hydrated_attachments';
import { hydrate_run_attachments } from '@runtime-platform/attachments/hydrate_run_attachments';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { describe, expect, it } from 'vitest';

describe('an attached file is reachable by the tools the agent actually has', () => {
  it('hands the local runtime a path its own read tool can open', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'attachment-reachable-'));
    try {
      const environment = create_local_session_env({
        workspace_root: root,
        working_directory: root,
      });
      const hydration = await hydrate_run_attachments(environment, [
        source('att_1', 'notes.md', 'ATTACHED'),
      ]);
      const [described] = describe_hydrated_attachments(environment, 'run_1', [], hydration);

      const model_path = (described as { path?: string }).path;
      expect(model_path).toBe('tmp/attachments/att_1/notes.md');

      const read_result = await create_built_in_tools()
        .find((tool) => tool.tool_name === 'read')
        ?.execute?.(
          { path: model_path },
          { run_key: 'run_1', session_key: 's', environment, metadata: {} },
        );
      expect(read_result).toMatchObject({
        ok: true,
        content_text: expect.stringContaining('ATTACHED'),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hands a sandbox-style environment an absolute path SessionEnv can open', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'attachment-reachable-abs-'));
    await mkdir(path.join(root, 'repo'), { recursive: true });
    try {
      const base = create_local_session_env({
        workspace_root: root,
        working_directory: path.join(root, 'repo'),
      });
      const environment = {
        ...base,
        metadata: {
          ...base.metadata,
          agent_tools_address_files_by: 'workspace_absolute_path' as const,
        },
      };
      const hydration = await hydrate_run_attachments(environment, [
        source('att_1', 'notes.md', 'ATTACHED'),
      ]);
      const [described] = describe_hydrated_attachments(environment, 'run_1', [], hydration);

      expect((described as { path?: string }).path).toBe(
        '/workspace/tmp/attachments/att_1/notes.md',
      );
      await expect(
        environment.read_file?.('/workspace/tmp/attachments/att_1/notes.md'),
      ).resolves.toBe('ATTACHED');
      expect(generate_agent_visible_path(environment, 'tmp/x')).toBe('/workspace/tmp/x');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function source(
  attachment_id: string,
  file_name: string,
  contents: string,
): RuntimeAttachmentSource {
  const bytes = new TextEncoder().encode(contents);
  return {
    attachment_id,
    file_name,
    mime_type: 'text/markdown',
    byte_size: bytes.byteLength,
    open_bytes: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}
