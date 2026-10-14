import { createHash } from 'node:crypto';
import type {
  ObjectStorage,
  StoredObjectDescription,
} from '@runtime-platform/files/object_storage';

export type InMemoryObjectStorage = ObjectStorage & {
  objects: Map<string, { data: Uint8Array; content_type: string }>;
};

export function create_in_memory_object_storage(
  objects = new Map<string, { data: Uint8Array; content_type: string }>(),
): InMemoryObjectStorage {
  const require_object = (object_key: string) => {
    const stored = objects.get(object_key);
    if (!stored) throw new Error(`Object ${object_key} not found`);
    return stored;
  };

  return {
    objects,
    put_if_absent: async ({ object_key, data, content_type }) => {
      const created = !objects.has(object_key);
      if (created) objects.set(object_key, { data, content_type });
      return { created };
    },
    list_by_prefix: async ({ object_key_prefix }) => ({
      objects: [...objects.entries()]
        .filter(([object_key]) => object_key.startsWith(object_key_prefix))
        .map(([object_key, stored]) => ({
          object_key,
          byte_size: stored.data.byteLength,
          entity_tag: `"${createHash('md5').update(stored.data).digest('hex')}"`,
        })),
      next_page_token: null,
    }),
    read: async (object_key) => require_object(object_key).data,
    open_stream: async (object_key) => {
      const { data } = require_object(object_key);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
    },
    describe: async (object_key): Promise<StoredObjectDescription | null> => {
      const stored = objects.get(object_key);
      if (!stored) return null;
      return {
        byte_size: stored.data.byteLength,
        content_type: stored.content_type,
        entity_tag: null,
      };
    },
    delete: async (object_key) => {
      objects.delete(object_key);
    },
    create_presigned_put_url: async ({ object_key, content_type }) =>
      `memory://objects/${encodeURIComponent(object_key)}?content_type=${encodeURIComponent(content_type)}`,
    create_presigned_get_url: async ({ object_key, file_name }) =>
      `memory://objects/${encodeURIComponent(object_key)}?download=${encodeURIComponent(file_name)}`,
  };
}
