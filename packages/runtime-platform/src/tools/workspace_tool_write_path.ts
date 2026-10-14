import { canonical_workspace_file_path } from '@runtime-platform/tools/workspace_tool_paths';

const file_write_tool_names = new Set(['write', 'edit']);

export function write_path_of(
  tool_name: string,
  tool_input: Record<string, unknown>,
): string | null {
  if (!file_write_tool_names.has(tool_name)) return null;
  if (typeof tool_input.path !== 'string') return null;
  return canonical_workspace_file_path(tool_input.path);
}
