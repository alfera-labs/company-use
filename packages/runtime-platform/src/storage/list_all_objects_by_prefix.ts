import type { ListedObject, ObjectStorage } from '@runtime-platform/files/object_storage';

const max_listed_objects = 500_000;

export async function list_all_objects_by_prefix(
  storage: ObjectStorage,
  object_key_prefix: string,
): Promise<ListedObject[]> {
  const objects: ListedObject[] = [];
  let page_token: string | null = null;
  do {
    const page = await storage.list_by_prefix({
      object_key_prefix,
      ...(page_token === null ? {} : { page_token }),
    });
    objects.push(...page.objects);
    if (objects.length > max_listed_objects) {
      throw new Error(
        `Prefix ${object_key_prefix} holds more than ${max_listed_objects} objects; refusing to list it in memory`,
      );
    }
    page_token = page.next_page_token;
  } while (page_token !== null);
  return objects;
}
