import type { Database } from '@coworker/core';
import type { MemoryDependencies } from '@coworker/memory/contracts/dependencies';

export function build_coworker_memory_dependencies(_db: Database): MemoryDependencies {
  return { extra_scope_kinds: [], embedder: null };
}
