import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env, type SessionEnv } from '@agent-core/environment';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { runtime_read_attachment_tool } from '@runtime-platform/tools/definitions/runtime_read_attachment';
import { describe, expect, it, vi } from 'vitest';

const attachment_id = 'slack:T123:F123';
const complete_bytes = Uint8Array.from([1, 2, 3, 4]);

function create_source(open_bytes: RuntimeAttachmentSource['open_bytes']): RuntimeAttachmentSource {
  return {
    attachment_id,
    file_name: 'customers.csv',
    mime_type: 'text/csv',
    byte_size: complete_bytes.byteLength,
    open_bytes,
  };
}

function stream_bytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function interrupted_stream(bytes: Uint8Array) {
  let sent_bytes = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent_bytes) {
        sent_bytes = true;
        controller.enqueue(bytes);
        return;
      }
      controller.error(new TypeError('terminated'));
    },
  });
}

async function with_local_environment(test: (environment: SessionEnv) => Promise<void>) {
  const workspace_root = await mkdtemp(path.join(tmpdir(), 'read-attachment-'));
  const working_directory = path.join(workspace_root, 'repo');
  await mkdir(working_directory);
  try {
    await test(create_local_session_env({ workspace_root, working_directory }));
  } finally {
    await rm(workspace_root, { recursive: true, force: true });
  }
}

function execute_read_attachment(
  source: RuntimeAttachmentSource,
  environment: SessionEnv,
  requested_attachment_id = attachment_id,
) {
  return runtime_read_attachment_tool.execute({ attachment_id: requested_attachment_id }, {
    environment,
    attachment_sources: new Map([[attachment_id, source]]),
  } as never);
}

describe('runtime read attachment', () => {
  it('accepts the bare provider file id instead of the canonical attachment id', async () => {
    await with_local_environment(async (environment) => {
      const source = create_source(async () => stream_bytes(complete_bytes));

      const result = await execute_read_attachment(source, environment, 'F123');

      expect(result).toMatchObject({
        success: true,
        data: { attachment_id, file_name: 'customers.csv' },
      });
    });
  });

  it('names the available attachment ids when the requested one is not in this run', async () => {
    await with_local_environment(async (environment) => {
      const source = create_source(async () => stream_bytes(complete_bytes));

      const result = await execute_read_attachment(source, environment, 'slack:T123:F_OTHER');

      expect(result).toMatchObject({
        success: false,
        error: { message: expect.stringContaining('slack:T123:F123') },
      });
    });
  });

  it('reopens a provider stream that ends before every byte arrives', async () => {
    await with_local_environment(async (environment) => {
      const open_bytes = vi
        .fn<RuntimeAttachmentSource['open_bytes']>()
        .mockResolvedValueOnce(stream_bytes(complete_bytes.slice(0, 2)))
        .mockResolvedValueOnce(stream_bytes(complete_bytes));

      const result = await execute_read_attachment(create_source(open_bytes), environment);

      expect(result.success).toBe(true);
      expect(open_bytes).toHaveBeenCalledTimes(2);
      await expect(
        environment.read_bytes?.('/workspace/tmp/attachments/slack_T123_F123/customers.csv'),
      ).resolves.toEqual(complete_bytes);
    });
  });

  it('reports the exact short byte count after retries are exhausted', async () => {
    await with_local_environment(async (environment) => {
      const open_bytes = vi
        .fn<RuntimeAttachmentSource['open_bytes']>()
        .mockImplementation(async () => stream_bytes(complete_bytes.slice(0, 2)));

      const result = await execute_read_attachment(create_source(open_bytes), environment);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'validation_error',
          message: 'Attachment customers.csv ended after 2 of 4 bytes',
        },
      });
      expect(open_bytes).toHaveBeenCalledTimes(3);
    });
  });

  it('retries when the provider stream terminates with a transport error', async () => {
    await with_local_environment(async (environment) => {
      const open_bytes = vi
        .fn<RuntimeAttachmentSource['open_bytes']>()
        .mockResolvedValueOnce(interrupted_stream(complete_bytes.slice(0, 2)))
        .mockResolvedValueOnce(stream_bytes(complete_bytes));

      const result = await execute_read_attachment(create_source(open_bytes), environment);

      expect(result.success).toBe(true);
      expect(open_bytes).toHaveBeenCalledTimes(2);
    });
  });

  it('does not retry a provider stream that exceeds its declared size', async () => {
    await with_local_environment(async (environment) => {
      const open_bytes = vi
        .fn<RuntimeAttachmentSource['open_bytes']>()
        .mockResolvedValue(stream_bytes(Uint8Array.from([1, 2, 3, 4, 5])));

      const result = await execute_read_attachment(create_source(open_bytes), environment);

      expect(result).toMatchObject({ success: false });
      expect(open_bytes).toHaveBeenCalledTimes(1);
    });
  });
});
