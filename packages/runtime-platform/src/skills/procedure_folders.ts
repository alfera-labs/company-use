import type { SessionEnv } from '@agent-core/environment/session_env';
import { list_folder_names } from '@runtime-platform/storage/workspace_folder_listing';
import { procedures_folder } from '@runtime-platform/storage/workspace_layouts';
import { example_procedure_slug } from '@runtime-platform/storage/workspace_seed_files';

/** The names in skills/ that are procedure folders, or undefined when it could not be read. */
export async function list_procedure_slugs(
  environment: SessionEnv | undefined,
): Promise<string[] | undefined> {
  const names = await list_folder_names(environment, procedures_folder);
  return names?.filter(is_procedure_folder_name);
}

/**
 * A folder holding one procedure. INDEX.json, index.md and the shipped template are not
 * procedures: the first two are the compiler's own output and the third is a blank form.
 */
export function is_procedure_folder_name(name: string) {
  if (!name || name.startsWith('.') || name.includes('.')) return false;
  return name !== example_procedure_slug;
}
