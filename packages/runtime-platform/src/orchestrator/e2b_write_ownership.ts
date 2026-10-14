import path from 'node:path';
import { format_error_message } from '@coworker/shared';
import { e2b_workspace_root } from '@runtime-platform/orchestrator/e2b_command';
import { run_with_sandbox_write_lease } from '@runtime-platform/orchestrator/e2b_sandbox_write_lease';
import { archil_checkin, archil_checkout } from '@runtime-platform/orchestrator/e2b_volume';
import type { OpenVolume } from '@runtime-platform/storage/volume_runtime';
import { workspace_path_is_durable } from '@runtime-platform/storage/workspace_layouts';
import { FileNotFoundError, type Sandbox } from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

export async function run_with_e2b_write_ownership<T>(
  sandbox: E2bSandbox,
  volume: Pick<OpenVolume, 'root_path'> | undefined,
  agent_workspace_path: string,
  workspace_paths: string[],
  mutation: () => Promise<T>,
  options: { checkout_wait?: Parameters<typeof archil_checkout>[2] } = {},
): Promise<T> {
  const archil_paths = find_distinct_archil_paths(volume, agent_workspace_path, workspace_paths);
  const owned_mutation = () => run_owned_e2b_mutation(sandbox, archil_paths, mutation, options);
  if (archil_paths.length === 0) return mutation();
  return run_with_sandbox_write_lease(sandbox, owned_mutation);
}

async function run_owned_e2b_mutation<T>(
  sandbox: E2bSandbox,
  archil_paths: string[],
  mutation: () => Promise<T>,
  options: { checkout_wait?: Parameters<typeof archil_checkout>[2] },
) {
  const existing_paths = await find_existing_archil_paths(sandbox, archil_paths);
  await checkout_archil_paths(sandbox, existing_paths, options.checkout_wait);
  return run_owned_mutation(sandbox, existing_paths, mutation);
}

function find_distinct_archil_paths(
  volume: Pick<OpenVolume, 'root_path'> | undefined,
  agent_workspace_path: string,
  workspace_paths: string[],
) {
  const archil_paths = workspace_paths
    .map((workspace_path) => find_archil_path(volume, agent_workspace_path, workspace_path))
    .filter((archil_path): archil_path is string => Boolean(archil_path));
  const sorted_paths = [...new Set(archil_paths)].sort(
    (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
  );
  return sorted_paths.filter(
    (candidate, index) =>
      !sorted_paths
        .slice(0, index)
        .some((parent) => candidate === parent || candidate.startsWith(`${parent}/`)),
  );
}

function find_archil_path(
  volume: Pick<OpenVolume, 'root_path'> | undefined,
  agent_workspace_path: string,
  workspace_path: string,
) {
  if (!volume) return null;
  const relative_path = path.posix.relative(e2b_workspace_root, workspace_path);
  if (relative_path.startsWith('../') || path.posix.isAbsolute(relative_path)) {
    return null;
  }
  if (relative_path === '') return path.posix.join(volume.root_path, agent_workspace_path);
  if (!workspace_path_is_durable(relative_path)) return null;
  return path.posix.join(volume.root_path, agent_workspace_path, relative_path);
}

async function checkout_archil_paths(
  sandbox: E2bSandbox,
  paths: string[],
  wait?: Parameters<typeof archil_checkout>[2],
) {
  const acquired_paths: string[] = [];
  try {
    for (const archil_path of paths) {
      await archil_checkout(sandbox, archil_path, wait);
      acquired_paths.push(archil_path);
    }
  } catch (error) {
    const checkin_errors = await checkin_archil_paths(sandbox, acquired_paths);
    if (checkin_errors.length === 0) throw error;
    throw new AggregateError([error, ...checkin_errors], 'Archil checkout failed.');
  }
}

async function run_owned_mutation<T>(
  sandbox: E2bSandbox,
  checkout_paths: string[],
  mutation: () => Promise<T>,
) {
  const mutation_result = await mutation().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const checkin_errors = await checkin_archil_paths(sandbox, checkout_paths);
  const errors = [...(mutation_result.ok ? [] : [mutation_result.error]), ...checkin_errors];
  if (errors.length > 0) {
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(
          errors,
          `E2B file mutation failed: ${errors.map((error) => format_error_message(error)).join('; ')}`,
        );
  }
  if (!mutation_result.ok) throw mutation_result.error;
  return mutation_result.value;
}

async function find_existing_archil_paths(sandbox: E2bSandbox, paths: string[]) {
  const existing = await Promise.all(
    paths.map((archil_path) => e2b_file_exists(sandbox, archil_path)),
  );
  return paths.filter((_, index) => existing[index]);
}

async function checkin_archil_paths(sandbox: E2bSandbox, paths: string[]) {
  const results = await Promise.allSettled(
    paths.map((archil_path) => archil_checkin(sandbox, archil_path)),
  );
  return rejected_reasons(results);
}

function rejected_reasons(results: PromiseSettledResult<unknown>[]) {
  return results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
}

async function e2b_file_exists(sandbox: E2bSandbox, file_path: string) {
  try {
    await sandbox.files.getInfo(file_path);
    return true;
  } catch (error) {
    if (error instanceof FileNotFoundError) return false;
    throw error;
  }
}
