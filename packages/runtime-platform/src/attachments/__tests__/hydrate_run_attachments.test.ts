import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment';
import { hydrate_run_attachments } from '@runtime-platform/attachments/hydrate_run_attachments';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { describe, expect, it } from 'vitest';

describe('hydrate_run_attachments', () => {
  it('opens every attachment concurrently', async () => {
    await with_local_environment(async (environment) => {
      const attachment_count = 5;
      let entered_count = 0;
      let release_all = () => {};
      const all_entered = new Promise<void>((resolve) => {
        release_all = resolve;
      });

      const sources = Array.from({ length: attachment_count }, (_, index) =>
        make_source(`att_${index}`, `file-${index}.bin`, `bytes-${index}`, async () => {
          entered_count += 1;
          if (entered_count === attachment_count) release_all();
          await all_entered;
          return stream_of(`bytes-${index}`);
        }),
      );

      const hydration = await hydrate_run_attachments(environment, sources);

      expect(entered_count).toBe(attachment_count);
      expect(hydration.failed).toEqual([]);
      expect(hydration.hydrated.map((item) => item.workspace_path)).toEqual(
        sources.map((_, index) => `tmp/attachments/att_${index}/file-${index}.bin`),
      );
    });
  });

  it('keeps the attachments that landed when one fails', async () => {
    await with_local_environment(async (environment) => {
      const hydration = await hydrate_run_attachments(environment, [
        make_source('att_ok', 'report.csv', 'id,name', async () => stream_of('id,name')),
        make_source('att_broken', 'broken.bin', 'unused', async () => {
          throw new Error('provider refused the download');
        }),
      ]);

      expect(hydration.hydrated).toHaveLength(1);
      expect(hydration.hydrated[0]?.workspace_path).toBe('tmp/attachments/att_ok/report.csv');
      expect(hydration.failed).toEqual([
        {
          attachment_id: 'att_broken',
          file_name: 'broken.bin',
          reason: 'provider refused the download',
        },
      ]);
      await expect(
        environment.read_bytes?.('/workspace/tmp/attachments/att_ok/report.csv'),
      ).resolves.toEqual(new TextEncoder().encode('id,name'));
    });
  });

  it('never writes into a persistent workspace directory', async () => {
    await with_local_environment(async (environment) => {
      const hydration = await hydrate_run_attachments(environment, [
        make_source('att_1', 'notes.txt', 'hello', async () => stream_of('hello')),
      ]);

      for (const attachment of hydration.hydrated) {
        expect(attachment.workspace_path.startsWith('tmp/')).toBe(true);
        expect(attachment.workspace_path).not.toContain('repo/');
      }
    });
  });

  it('does nothing when the message carries no attachments', async () => {
    await with_local_environment(async (environment) => {
      await expect(hydrate_run_attachments(environment, [])).resolves.toEqual({
        hydrated: [],
        failed: [],
      });
    });
  });
});

function make_source(
  attachment_id: string,
  file_name: string,
  contents: string,
  open_bytes: RuntimeAttachmentSource['open_bytes'],
): RuntimeAttachmentSource {
  return {
    attachment_id,
    file_name,
    mime_type: 'application/octet-stream',
    byte_size: new TextEncoder().encode(contents).byteLength,
    open_bytes,
  };
}

function stream_of(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function with_local_environment(
  run: (environment: ReturnType<typeof create_local_session_env>) => Promise<void>,
) {
  const workspace_root = await mkdtemp(path.join(tmpdir(), 'hydrate-attachments-'));
  await mkdir(path.join(workspace_root, 'repo'), { recursive: true });
  try {
    await run(
      create_local_session_env({
        workspace_root,
        working_directory: path.join(workspace_root, 'repo'),
      }),
    );
  } finally {
    await rm(workspace_root, { recursive: true, force: true });
  }
}
