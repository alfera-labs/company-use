// @vitest-environment happy-dom

import { AlertDialog, AlertDialogContent } from '@coworker/ui/components/alert-dialog';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CodeBlockCopyButton } from 'streamdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { append_chat_attachments } from '@/components/app/append_chat_attachments';
import { create_client_message_id } from '@/components/app/chat_optimistic_messages';
import { read_desktop_notification_permission } from '@/components/app/desktop_notifications';
import { MintedApiKeySecret } from '@/components/app/minted_api_key_secret';
import type { MintedApiKey } from '@/lib/api/types';
import { copy_text, offer_a_clipboard_on_plain_http } from '@/lib/copy_text';
import { read_file_content_version } from '@/lib/file_content_version';

const uuid_shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const real_crypto = globalThis.crypto;
let root: Root | null = null;
let copied_selections: string[] = [];

function stand_on_plain_http() {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => real_crypto.getRandomValues(bytes),
  });
  vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: undefined });
  vi.stubGlobal('isSecureContext', false);
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  document.execCommand = (command: string) => {
    if (command === 'copy') copied_selections.push(window.getSelection()?.toString() ?? '');
    return true;
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  copied_selections = [];
  stand_on_plain_http();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('on plain http, where the browser offers no randomUUID, clipboard or subtle crypto', () => {
  it('attaches a file and gives each chip its own id', () => {
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];

    const { attachments } = append_chat_attachments(files, [], { on_attachment_changed: () => {} });

    expect(attachments.map((attachment) => attachment.name)).toEqual(['a.txt', 'b.txt']);
    const ids = attachments.map((attachment) => attachment.id.replace('attachment:', ''));
    expect(ids[0]).toMatch(uuid_shape);
    expect(ids[1]).toMatch(uuid_shape);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('gives a new chat message an id', () => {
    expect(create_client_message_id().replace('client:', '')).toMatch(uuid_shape);
  });

  it('copies the new API key when the person presses "Copy key"', async () => {
    const minted = {
      secret: 'alf_test_not_a_real_key',
      api_key: { key_name: 'Laptop', key_prefix: 'alf_test' },
    } as MintedApiKey;
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        createElement(
          AlertDialog,
          { open: true },
          createElement(
            AlertDialogContent,
            null,
            createElement(MintedApiKeySecret, { minted, on_done: () => {} }),
          ),
        ),
      ),
    );
    const copy_button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Copy key',
    );
    if (!copy_button) throw new Error('The "Copy key" button did not render');

    await act(async () => copy_button.click());

    expect(copied_selections).toEqual(['alf_test_not_a_real_key']);
    expect(copy_button.textContent).toBe('Copied');
  });

  it('keeps line breaks in copied text and leaves nothing behind on the page', async () => {
    await copy_text('first line\nsecond line');

    expect(copied_selections).toEqual(['first line\nsecond line']);
    expect(document.body.textContent).toBe('');
  });

  it('copies from the copy button of a code block in an answer, and the button shows it', async () => {
    offer_a_clipboard_on_plain_http();
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(createElement(CodeBlockCopyButton, { code: 'echo hello' })));
    const copy_button = container.querySelector('button');
    if (!copy_button) throw new Error('The copy button of the code block did not render');
    const icon_before = copy_button.innerHTML;

    await act(async () => copy_button.click());

    expect(copied_selections).toEqual(['echo hello']);
    expect(copy_button.innerHTML).not.toBe(icon_before);
  });

  it('copies a table through the clipboard it gives the page', async () => {
    offer_a_clipboard_on_plain_http();
    const table_as_text = new Blob(['name\tcompany'], { type: 'text/plain' });

    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': table_as_text })]);

    expect(copied_selections).toEqual(['name\tcompany']);
  });

  it('leaves the clipboard of an https page alone', () => {
    const clipboard_of_the_browser = { writeText: async () => {} };
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: clipboard_of_the_browser });

    offer_a_clipboard_on_plain_http();

    expect(navigator.clipboard).toBe(clipboard_of_the_browser);
  });

  it('says so when the browser copies nothing', async () => {
    document.execCommand = () => false;

    await expect(copy_text('text')).rejects.toThrow('Select it and copy it by hand');
  });

  it('reads the version of a file from the header the API sends', async () => {
    const headers = new Headers({ ETag: `"${'ab'.repeat(32)}"` });

    expect(await read_file_content_version(headers, new ArrayBuffer(4))).toBe('ab'.repeat(32));
  });

  it('says a file has no version when the API sent none, instead of failing on a missing API', async () => {
    await expect(read_file_content_version(new Headers(), new ArrayBuffer(4))).rejects.toThrow(
      'no version',
    );
  });

  it('reports that notifications need https', () => {
    vi.stubGlobal('Notification', { permission: 'denied' });

    expect(read_desktop_notification_permission()).toBe('needs_https');
  });
});
