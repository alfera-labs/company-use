import { describe, expect, it } from 'vitest';
import {
  read_chat_message_files,
  read_chat_message_images,
  read_chat_message_text,
} from '@/components/app/chat_timeline';
import type { RunMessage } from '@/lib/api';

describe('chat message images', () => {
  it('reads attached images as thumbnails and keeps them out of the text', () => {
    const message = chat_message({
      message_role: 'user',
      message_sequence: 1,
      run_message_id: 'msg_user',
      text: 'yo',
      parts: [
        { type: 'text', text: 'yo' },
        { type: 'image', data: 'AAAA', mime_type: 'image/jpeg', source: 'porch.jpg' },
      ],
    });

    expect(read_chat_message_images(message.message_content)).toEqual([
      { key: '1:porch.jpg', data_url: 'data:image/jpeg;base64,AAAA', name: 'porch.jpg' },
    ]);
    expect(read_chat_message_text(message.message_content)).toBe('yo');
  });

  it('names an unnamed image by position', () => {
    const message = chat_message({
      message_role: 'user',
      message_sequence: 1,
      run_message_id: 'msg_user',
      text: '',
      parts: [{ type: 'image', data: 'AAAA', mime_type: 'image/png' }],
    });

    expect(read_chat_message_images(message.message_content)).toEqual([
      { key: '0:image', data_url: 'data:image/png;base64,AAAA' },
    ]);
  });

  it('leaves the preview text readers naming the image', () => {
    const message = chat_message({
      message_role: 'user',
      message_sequence: 1,
      run_message_id: 'msg_user',
      text: '',
      parts: [{ type: 'image', data: 'AAAA', mime_type: 'image/png', source: 'porch.jpg' }],
    });

    expect(read_chat_message_text(message.message_content)).toBe('[image: porch.jpg]');
  });

  it('ignores parts that are not images', () => {
    const message = chat_message({
      message_role: 'user',
      message_sequence: 1,
      run_message_id: 'msg_user',
      text: 'see the deck',
      parts: [
        { type: 'text', text: 'see the deck' },
        { type: 'file', file_id: 'art_1', name: 'deck.pdf', mime_type: 'application/pdf' },
      ],
    });

    expect(read_chat_message_images(message.message_content)).toEqual([]);
  });
});

describe('chat message files', () => {
  it('keys a stored file by its id and an inline one by position', () => {
    const message = chat_message({
      message_role: 'user',
      message_sequence: 1,
      run_message_id: 'msg_user',
      text: 'both',
      parts: [
        { type: 'file', file_id: 'art_1', name: 'deck.pdf', mime_type: 'application/pdf' },
        { type: 'file', name: 'notes.md', mime_type: 'text/markdown', text: '# notes' },
      ],
    });

    expect(read_chat_message_files(message.message_content)).toEqual([
      {
        key: 'art_1',
        file_id: 'art_1',
        name: 'deck.pdf',
        mime_type: 'application/pdf',
        is_inline_text: false,
      },
      { key: '1:notes.md', name: 'notes.md', mime_type: 'text/markdown', is_inline_text: true },
    ]);
  });
});

function chat_message(input: {
  message_role: 'assistant' | 'user';
  message_sequence: number;
  parts?: unknown[];
  run_id?: string;
  run_message_id: string;
  text: string;
}): RunMessage {
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_model_visible: true,
    is_user_visible: true,
    last_updated_time: '2026-06-16T00:00:00.000Z',
    message_content: {
      ...(input.text ? { text: input.text } : {}),
      type: input.parts ? 'multimodal' : 'text',
      ...(input.parts ? { parts: input.parts } : {}),
    },
    message_kind: input.message_role === 'user' ? 'input' : 'output',
    message_role: input.message_role,
    message_sequence: input.message_sequence,
    run_id: input.run_id ?? 'run_user',
    run_message_id: input.run_message_id,
    run_message_sequence: input.message_sequence,
    session_id: 'ses_1',
    source_metadata: {},
    workspace_id: 'wsp_1',
  } as unknown as RunMessage;
}
