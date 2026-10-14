import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env, type SessionEnv } from '@agent-core/environment';
import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import { describe_hydrated_attachments } from '@runtime-platform/attachments/describe_hydrated_attachments';
import { hydrate_run_attachments } from '@runtime-platform/attachments/hydrate_run_attachments';
import { create_image_attachment_sources } from '@runtime-platform/attachments/image_attachment_sources';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import { runtime_read_attachment_tool } from '@runtime-platform/tools/definitions/runtime_read_attachment';
import { describe, expect, it } from 'vitest';

const run_id = 'run_01';
const png_bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function image_part(overrides: Partial<RuntimeAgentMessagePart> = {}): RuntimeAgentMessagePart {
  return {
    type: 'image',
    data: Buffer.from(png_bytes).toString('base64'),
    mime_type: 'image/png',
    source: 'porch.png',
    ...overrides,
  } as RuntimeAgentMessagePart;
}

function filler_source(index: number): RuntimeAttachmentSource {
  return {
    attachment_id: `art_${index}`,
    file_name: `report-${index}.csv`,
    mime_type: 'text/csv',
    byte_size: 1,
    open_bytes: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1]));
          controller.close();
        },
      }),
  };
}

async function with_local_environment(test: (environment: SessionEnv) => Promise<void>) {
  const workspace_root = await mkdtemp(path.join(tmpdir(), 'image-attachments-'));
  const working_directory = path.join(workspace_root, 'repo');
  await mkdir(working_directory);
  try {
    await test(create_local_session_env({ workspace_root, working_directory }));
  } finally {
    await rm(workspace_root, { recursive: true, force: true });
  }
}

describe('create_image_attachment_sources', () => {
  it('carries the image bytes so hydration writes the picture to a real path', async () => {
    await with_local_environment(async (environment) => {
      const parts = [{ type: 'text' as const, text: 'save it in my files' }, image_part()];
      const { sources, notes } = create_image_attachment_sources(run_id, parts, []);

      expect(notes).toEqual([]);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        attachment_id: 'inline-image-run_01-2',
        file_name: 'porch.png',
        mime_type: 'image/png',
        byte_size: png_bytes.byteLength,
      });

      const hydration = await hydrate_run_attachments(environment, sources);

      expect(hydration.failed).toEqual([]);
      expect(hydration.hydrated[0]?.workspace_path).toBe(
        'tmp/attachments/inline-image-run_01-2/porch.png',
      );
      await expect(
        environment.read_bytes?.('/workspace/tmp/attachments/inline-image-run_01-2/porch.png'),
      ).resolves.toEqual(png_bytes);
    });
  });

  it('adds a file part naming the path while the vision part stays untouched', async () => {
    await with_local_environment(async (environment) => {
      const parts = [image_part()];
      const { sources } = create_image_attachment_sources(run_id, parts, []);
      const hydration = await hydrate_run_attachments(environment, sources);

      const described = describe_hydrated_attachments(environment, run_id, parts, hydration);

      expect(described[0]).toEqual(parts[0]);
      expect(described[1]).toEqual({
        type: 'file',
        name: 'porch.png',
        mime_type: 'image/png',
        path: 'tmp/attachments/inline-image-run_01-1/porch.png',
      });
    });
  });

  it('keeps the file_id of an attachment that came from a stored file', async () => {
    await with_local_environment(async (environment) => {
      const stored = { ...filler_source(1), stored_file_id: 'art_1' };
      const hydration = await hydrate_run_attachments(environment, [stored]);

      const described = describe_hydrated_attachments(environment, run_id, [], hydration);

      expect(described[0]).toMatchObject({ type: 'file', file_id: 'art_1' });
    });
  });

  it('lets read_attachment find the image by its id', async () => {
    await with_local_environment(async (environment) => {
      const { sources } = create_image_attachment_sources(run_id, [image_part()], []);
      const attachment_sources = new Map(sources.map((source) => [source.attachment_id, source]));

      const result = await runtime_read_attachment_tool.execute(
        { attachment_id: 'inline-image-run_01-1' },
        { environment, attachment_sources } as never,
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          file_name: 'porch.png',
          path: 'tmp/attachments/inline-image-run_01-1/porch.png',
        },
      });
    });
  });

  it('skips the images past the per-message cap and says which ones', () => {
    const parts = Array.from({ length: 3 }, (_, index) =>
      image_part({ source: `shot-${index}.png` }),
    );
    const existing = Array.from({ length: 19 }, (_, index) => filler_source(index));

    const { sources, notes } = create_image_attachment_sources(run_id, parts, existing);

    expect(sources.map((source) => source.file_name)).toEqual(['shot-0.png']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('shot-1.png, shot-2.png'),
    });
  });

  it('skips an image that alone exceeds what the message has left', () => {
    const oversized = image_part({ data: 'A'.repeat(40 * 1024 * 1024) });

    const { sources, notes } = create_image_attachment_sources(run_id, [oversized], []);

    expect(sources).toEqual([]);
    expect(notes).toHaveLength(1);
  });

  it('derives a file name from the mime type when the client sent none', () => {
    const parts = [
      image_part({ source: undefined, mime_type: 'image/jpeg' }),
      image_part({ source: '/tmp/../holiday photo.png' }),
      image_part({ source: 'no-extension', mime_type: 'image/webp' }),
    ];

    const { sources } = create_image_attachment_sources(run_id, parts, []);

    expect(sources.map((source) => source.file_name)).toEqual([
      'image-1.jpeg',
      'holiday photo.png',
      'no-extension.webp',
    ]);
  });

  it('returns nothing for a message with no images', () => {
    expect(create_image_attachment_sources(run_id, [{ type: 'text', text: 'hello' }], [])).toEqual({
      sources: [],
      notes: [],
    });
  });
});
