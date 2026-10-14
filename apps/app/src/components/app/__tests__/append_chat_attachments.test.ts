import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  append_chat_attachments,
  type ChatAttachmentUpdate,
} from '@/components/app/append_chat_attachments';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';

vi.mock('@/components/app/chat_file_parts', async (import_original) => {
  const original = await import_original<typeof import('@/components/app/chat_file_parts')>();
  return {
    ...original,
    create_pending_chat_attachment: (...args: unknown[]) => upload_stub(...args),
  };
});

let upload_stub: (...args: unknown[]) => Promise<unknown>;

beforeEach(() => {
  upload_stub = () => new Promise(() => {});
});

describe('append_chat_attachments', () => {
  it('returns a chip immediately, before the upload finishes', () => {
    const { attachments } = append_chat_attachments([pdf_file()], [], {
      on_attachment_changed: () => {},
    });

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      name: 'deck.pdf',
      byte_size: 9_437_184,
      upload_status: 'uploading',
      upload_progress: 0,
    });
    expect(attachments[0]?.part).toBeUndefined();
  });

  it('reports progress and then settles the chip as ready', async () => {
    const updates: ChatAttachmentUpdate[] = [];
    upload_stub = async (_file, options) => {
      const { on_progress } = options as { on_progress: (fraction: number) => void };
      on_progress(0.5);
      return {
        part: { type: 'file', file_id: 'art_1', name: 'deck.pdf' },
        mime_type: 'application/pdf',
      };
    };

    const { attachments } = append_chat_attachments([pdf_file()], [], {
      on_attachment_changed: (update) => updates.push(update),
    });
    await vi.waitFor(() => expect(updates).toHaveLength(2));

    const id = attachments[0]?.id;
    expect(updates[0]).toEqual({ id, changes: { upload_progress: 0.5 } });
    expect(updates[1]?.changes).toMatchObject({ upload_status: 'ready', upload_progress: 1 });
    expect(updates[1]?.changes.part).toMatchObject({ file_id: 'art_1' });
  });

  it('marks the chip failed rather than dropping it', async () => {
    const updates: ChatAttachmentUpdate[] = [];
    upload_stub = async () => {
      throw new Error('the storage bucket refused the request');
    };

    append_chat_attachments([pdf_file()], [], {
      on_attachment_changed: (update) => updates.push(update),
    });
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    expect(updates[0]?.changes).toMatchObject({
      upload_status: 'failed',
      upload_error: 'the storage bucket refused the request',
    });
  });

  it('rejects an oversize file with a sentence naming it', () => {
    const huge = new File([new Uint8Array(0)], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(huge, 'size', { value: 64 * 1024 * 1024 });

    const { attachments, rejections } = append_chat_attachments([huge], [], {
      on_attachment_changed: () => {},
    });

    expect(attachments).toHaveLength(0);
    expect(rejections[0]).toContain('huge.zip');
    expect(rejections[0]).toContain('25 MB');
  });

  it('counts files already attached against the limit', () => {
    const already: PendingChatAttachment[] = Array.from({ length: 20 }, (_, index) => ({
      id: `attachment:${index}`,
      name: `f${index}.pdf`,
      mime_type: 'application/pdf',
      byte_size: 1,
      upload_status: 'ready',
      upload_progress: 1,
    }));

    const { attachments, rejections } = append_chat_attachments([pdf_file()], already, {
      on_attachment_changed: () => {},
    });

    expect(attachments).toHaveLength(0);
    expect(rejections[0]).toContain('20 files');
  });
});

function pdf_file() {
  const file = new File([new Uint8Array(0)], 'deck.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: 9_437_184 });
  return file;
}
