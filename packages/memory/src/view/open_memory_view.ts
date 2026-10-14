import type { OpenViewInput } from '@coworker/memory/contracts/audience';
import type { MemoryDependencies } from '@coworker/memory/contracts/dependencies';
import type { MemoryView } from '@coworker/memory/contracts/operations';
import type { ScopeKindRegistry } from '@coworker/memory/contracts/scopes';
import { not_in_this_edition } from '@coworker/memory/not_in_this_edition';

export async function open_memory_view(
  _dependencies: MemoryDependencies,
  _registry: ScopeKindRegistry,
  _input: OpenViewInput,
): Promise<MemoryView> {
  return not_in_this_edition('Company memory');
}
