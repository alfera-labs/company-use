import {
  find_model_proxy_credential,
  list_model_proxies_for_use_case_and_access,
  type ModelAccessRules,
  type ModelProxy,
  read_model_provider,
} from '@coworker/shared';
import { list_model_ids_for_proxy } from '@runtime-platform/model_proxy_catalog';
import type { WorkspaceModelEnvironment } from '@runtime-platform/workspace_model_environment';

export type WorkspaceModelRoute = { model_proxy: string; model_name: string | null };

export function find_the_workspaces_own_route(input: {
  resolved: { model_provider: string; model_name: string; credential_env_name: string };
  model_environment: WorkspaceModelEnvironment | undefined;
  route_chosen_on_this_request: boolean;
  model_access?: ModelAccessRules;
}): WorkspaceModelRoute | null {
  const { resolved, model_environment, route_chosen_on_this_request } = input;
  const owned = model_environment?.workspace_owned_env_names;
  if (!model_environment || !owned?.size || route_chosen_on_this_request) return null;
  if (owned.has(resolved.credential_env_name)) return null;

  const workspace_proxies = list_model_proxies_for_use_case_and_access(
    'agent_run',
    input.model_access,
  ).filter((proxy) => is_credential_owned_by_the_workspace(proxy, model_environment, owned));
  const workspace_proxy =
    workspace_proxies.find(
      (proxy) => read_model_provider(proxy, resolved.model_name) === resolved.model_provider,
    ) ?? workspace_proxies[0];
  if (!workspace_proxy) return null;

  const serves_the_same_model = list_model_ids_for_proxy(workspace_proxy.model_proxy).includes(
    resolved.model_name,
  );
  return {
    model_proxy: workspace_proxy.model_proxy,
    model_name: serves_the_same_model ? resolved.model_name : null,
  };
}

/** What the run asked for, when the deployment holds no credential to resolve it with. */
export function route_the_deployment_cannot_serve(request: {
  model_provider: string | null;
  model_name: string | null;
}) {
  return {
    model_provider: request.model_provider ?? '',
    model_name: request.model_name ?? '',
    credential_env_name: '',
  };
}

function is_credential_owned_by_the_workspace(
  proxy: ModelProxy,
  model_environment: WorkspaceModelEnvironment,
  owned: ReadonlySet<string>,
) {
  const credential = find_model_proxy_credential(proxy.model_proxy, model_environment.environment);
  return credential !== undefined && owned.has(credential.env_name);
}
