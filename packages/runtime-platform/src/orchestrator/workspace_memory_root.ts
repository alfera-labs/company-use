import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function prepare_workspace_memory_root_directory(
  host_workspace_root: string,
): Promise<string> {
  const memory_root_directory = path.join(path.dirname(host_workspace_root), 'memory');
  await fs.mkdir(memory_root_directory, { recursive: true });
  return memory_root_directory;
}
