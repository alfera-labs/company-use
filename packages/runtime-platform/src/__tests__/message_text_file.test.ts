import type { SessionEnv } from '@agent-core/environment/session_env';
import {
  describe_message_text_file,
  message_text_file_path,
  write_message_text_file,
} from '@runtime-platform/attachments/message_text_file';
import { describe, expect, it } from 'vitest';

function fake_environment(writes: Array<[string, string]>) {
  return {
    env_key: 'test',
    env_kind: 'custom',
    metadata: { model_workspace_root: '/workspace' },
    write: async (path: string, contents: string) => {
      writes.push([path, contents]);
    },
  } as unknown as SessionEnv;
}

describe('the message text file', () => {
  it('writes a long message to one fixed path and tells the model where', async () => {
    const writes: Array<[string, string]> = [];
    const text = 'lead | title | company\n'.repeat(200);

    const written = await write_message_text_file(fake_environment(writes), text);

    expect(writes).toEqual([[message_text_file_path, text]]);
    expect(written?.path).toContain('tmp/message.md');
    const [note] = describe_message_text_file(written);
    expect(note?.type).toBe('text');
    expect(note?.type === 'text' ? note.text : '').toContain(written?.path ?? 'no path');
  });

  it('leaves a short message and a sandbox without write alone', async () => {
    const writes: Array<[string, string]> = [];
    expect(await write_message_text_file(fake_environment(writes), 'hi')).toBeUndefined();
    expect(await write_message_text_file(undefined, 'x'.repeat(5_000))).toBeUndefined();
    expect(writes).toEqual([]);
    expect(describe_message_text_file(undefined)).toEqual([]);
  });
});
