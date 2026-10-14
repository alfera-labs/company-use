import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { read_workspace_model_environment } from '@coworker/runtime-platform';

export type ModelCatalogEnvironment = { environment: Record<string, string | undefined> };

/**
 * What the picker should show this workspace: the deployment's credentials with the workspace's
 * own model-provider keys laid over them. Read-only on purpose — drawing a picker must not rotate
 * a ChatGPT token, which spends a single-use refresh token and retires the account when it fails.
 */
export function read_workspace_model_catalog_environment(
  db: Database,
  workspace_id: string,
): Promise<ModelCatalogEnvironment> {
  return read_workspace_model_environment(
    db,
    workspace_id,
    deployment_model_environment().environment,
  );
}

/** The text settings of this deployment, and its self-host switch, which is not text. */
export function deployment_model_environment(): ModelCatalogEnvironment {
  const environment = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return {
    environment: { ...environment, COWORKER_SELF_HOSTED: String(env.COWORKER_SELF_HOSTED) },
  };
}
