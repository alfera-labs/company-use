import type { MemoryExecutor } from '@coworker/memory/contracts/dependencies';
import type { WorkspaceId } from '@coworker/memory/contracts/keys';

export async function has_consolidated_workspace_page(
  _executor: MemoryExecutor,
  _workspace_id: WorkspaceId,
): Promise<boolean> {
  return false;
}
