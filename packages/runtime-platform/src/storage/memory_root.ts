import path from 'node:path';
import {
  memory_root_model_path,
  memory_root_relative_path,
} from '@agent-core/environment/memory_root_path';

export type { ModelRootName, ModelRootRecord } from '@agent-core/environment/memory_root_path';
export {
  is_memory_root_path,
  memory_root_model_path,
  memory_root_open_slugs_key,
  model_root_of,
  open_scope_slug_of,
  read_open_memory_slugs,
} from '@agent-core/environment/memory_root_path';

/** The absolute sandbox path for a canonical memory-root path whose slug is open. */
export function memory_root_sandbox_path(canonical_path: string, open_slugs: ReadonlySet<string>) {
  return path.posix.join(
    memory_root_model_path,
    memory_root_relative_path(canonical_path, open_slugs),
  );
}
