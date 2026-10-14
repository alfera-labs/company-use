import type { SessionEnv } from '@agent-core/environment/session_env';
import { restore_chat_scratch_files } from '@runtime-platform/files/chat_scratch_files';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { afterEach, describe, expect, it } from 'vitest';

const chat = { workspace_id: 'ws_zq_test', session_id: 'ses_zq_test' };
const now = new Date('2026-10-10T12:00:00.000Z');
const chat_prefix = `workspace/${chat.workspace_id}/sessions/${chat.session_id}/scratch`;

afterEach(() => {
  set_memory_import_object_storage_for_tests(undefined);
});

function plant(objects: Record<string, string>) {
  const storage = create_in_memory_object_storage();
  for (const [object_key, text] of Object.entries(objects)) {
    storage.objects.set(object_key, {
      data: new TextEncoder().encode(text),
      content_type: 'text/plain',
    });
  }
  set_memory_import_object_storage_for_tests(storage);
}

function empty_sandbox() {
  const files = new Map<string, string>();
  const sandbox: SessionEnv = {
    env_key: 'sandbox_zq_test',
    env_kind: 'remote_sandbox',
    write: async (file_path, contents) => {
      files.set(file_path, contents);
    },
    read: async (file_path) => {
      const contents = files.get(file_path);
      if (contents === undefined) throw new Error(`ENOENT: ${file_path}`);
      return contents;
    },
  };
  return { sandbox, files };
}

describe('putting a chat scratch files back into a new sandbox', () => {
  it('puts back only scratch files from the last week, never a path on the volume', async () => {
    plant({
      [`${chat_prefix}/2026-10-10/tmp/tool-output/today.txt`]: 'zq-test today',
      [`${chat_prefix}/2026-10-04/tmp/activity/2026-10-04/run_1.jsonl`]: 'zq-test six days',
      [`${chat_prefix}/2026-09-30/tmp/tool-output/old.txt`]: 'zq-test ten days',
      [`${chat_prefix}/2026-10-10/system/activity/2026-10-10/run_2.jsonl`]: 'zq-test volume',
      [`${chat_prefix}/2026-10-10/tmp/../system/x.txt`]: 'zq-test escape',
      [`workspace/${chat.workspace_id}/sessions/ses_other/scratch/2026-10-10/tmp/tool-output/b.txt`]:
        'zq-test other chat',
    });
    const { sandbox, files } = empty_sandbox();

    await expect(restore_chat_scratch_files(chat, sandbox, now)).resolves.toBe(2);

    expect(Object.fromEntries(files)).toEqual({
      'tmp/tool-output/today.txt': 'zq-test today',
      'tmp/activity/2026-10-04/run_1.jsonl': 'zq-test six days',
    });
  });
});
