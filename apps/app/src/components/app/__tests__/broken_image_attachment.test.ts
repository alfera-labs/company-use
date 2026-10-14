// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  append_chat_attachments,
  type ChatAttachmentUpdate,
} from '@/components/app/append_chat_attachments';

afterEach(() => vi.unstubAllGlobals());

function browser_opens_images(can_open: (file: File) => boolean) {
  const opened_files: string[] = [];
  vi.stubGlobal('createImageBitmap', async (file: File) => {
    opened_files.push(file.name);
    if (!can_open(file)) throw new DOMException('The source image could not be decoded.');
    return { close: () => undefined };
  });
  return opened_files;
}

async function attach(file: File) {
  const updates: ChatAttachmentUpdate[] = [];
  const settled = new Promise<void>((resolve) => {
    append_chat_attachments([file], [], {
      on_attachment_changed: (update) => {
        updates.push(update);
        if (update.changes.upload_status !== undefined) resolve();
      },
    });
  });
  await settled;
  return updates.at(-1)?.changes;
}

const png = (name: string) => new File(['not really pixels'], name, { type: 'image/png' });

describe('attaching an image to a chat message', () => {
  it('refuses a png that is not an image, and says which file and what to do', async () => {
    browser_opens_images((file) => file.name !== 'broken.png');

    expect(await attach(png('broken.png'))).toEqual({
      upload_status: 'failed',
      upload_error: 'broken.png is not an image that can be opened. Choose another file.',
    });
  });

  it('takes a png the browser opens', async () => {
    browser_opens_images(() => true);

    expect(await attach(png('real.png'))).toMatchObject({
      upload_status: 'ready',
      part: { type: 'image', source: 'real.png' },
    });
  });

  it('does not judge an image type that not every browser opens', async () => {
    const opened_files = browser_opens_images(() => false);
    const photo = new File(['heic bytes'], 'photo.heic', { type: 'image/heic' });

    expect(await attach(photo)).toMatchObject({ upload_status: 'ready' });
    expect(opened_files).toEqual([]);
  });
});
