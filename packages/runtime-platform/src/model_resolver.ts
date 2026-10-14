import { type LlmEnvironment, resolve_llm_model } from '@agent-core/llm_gateway/model_resolver';
import type { RuntimeReasoningLevel } from '@agent-core/models/runtime_model_config';
import {
  agent_model_config_schema,
  create_logger,
  find_model_proxy,
  type ModelAccessRules,
  reasoning_levels,
  require_model_use_case_policy,
  unrestricted_model_access,
  workspace_model_access_levels,
} from '@coworker/shared';
import {
  route_or_null_without_a_credential,
  runtime_model_error,
} from '@runtime-platform/model_credential_error';
import {
  any_model,
  describe_model_request,
  keep_the_request_within_access,
  type ModelRequest,
  normalize_requested_model_route,
} from '@runtime-platform/model_request_access';
import type { WorkspaceModelEnvironment } from '@runtime-platform/workspace_model_environment';
import {
  find_the_workspaces_own_route,
  route_the_deployment_cannot_serve,
} from '@runtime-platform/workspace_model_route';
import { z } from 'zod';

const log = create_logger('model_resolver');
const agent_run_policy = require_model_use_case_policy('agent_run');

function default_reasoning_level(nobody_is_waiting: boolean) {
  if (!nobody_is_waiting) return agent_run_policy.reasoning_level;
  return (
    agent_run_policy.reasoning_level_when_nobody_is_waiting ?? agent_run_policy.reasoning_level
  );
}
const optional_model_identifier_schema = z.string().trim().min(1).nullish();

const model_resolution_input_schema = z
  .object({
    model_provider: optional_model_identifier_schema,
    model_proxy: optional_model_identifier_schema,
    model_name: optional_model_identifier_schema,
    default_model: optional_model_identifier_schema,
    default_model_provider: optional_model_identifier_schema,
    default_model_proxy: optional_model_identifier_schema,
    default_model_name: optional_model_identifier_schema,
    reasoning_level: z.enum(reasoning_levels).nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    max_output_tokens: z.number().int().min(1).max(128_000).nullish(),
    agent_config: agent_model_config_schema
      .nullish()
      .transform((agent_config) => agent_config ?? {}),
    model_access: z
      .object({
        model_access: z.enum(workspace_model_access_levels),
        gateway_models_enabled: z.boolean(),
      })
      .nullish(),
    workspace_id: z.string().nullish(),
    nobody_is_waiting: z.boolean().nullish(),
  })
  .strict();

export type ResolveModelInput = {
  model_provider?: string | null;
  model_proxy?: string | null;
  model_name?: string | null;
  default_model?: string | null;
  default_model_provider?: string | null;
  default_model_proxy?: string | null;
  default_model_name?: string | null;
  reasoning_level?: RuntimeReasoningLevel | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  agent_config?: unknown;
  model_access?: ModelAccessRules | null;
  workspace_id?: string | null;
  nobody_is_waiting?: boolean | null;
};

type ModelCredentialOrigin = 'workspace' | 'deployment';

export function resolve_model(
  input: ResolveModelInput = {},
  model_environment?: WorkspaceModelEnvironment,
) {
  const config = model_resolution_input_schema.parse(input);
  const requested_route = normalize_requested_model_route(config);
  const saved_model_proxy = config.default_model_proxy ?? config.agent_config.model_proxy;
  const model_request: ModelRequest = {
    model_provider:
      requested_route?.model_provider ??
      config.default_model_provider ??
      config.agent_config.model_provider ??
      null,
    model_proxy:
      requested_route?.model_proxy ??
      (requested_route ? null : (find_model_proxy(saved_model_proxy ?? '')?.model_proxy ?? null)),
    model_name:
      requested_route?.model_name ??
      config.default_model_name ??
      config.agent_config.model_name ??
      config.default_model ??
      null,
    reasoning_level:
      config.reasoning_level ??
      config.agent_config.reasoning_level ??
      default_reasoning_level(config.nobody_is_waiting ?? false),
    temperature: config.temperature ?? config.agent_config.temperature ?? undefined,
    max_output_tokens:
      config.max_output_tokens ?? config.agent_config.max_output_tokens ?? undefined,
  };
  const model_access = config.model_access ?? unrestricted_model_access;
  const environment = model_environment?.environment ?? process.env;
  const allowed_request = keep_the_request_within_access(model_request, model_access, environment);
  const pick_was_coerced = allowed_request !== model_request;
  const resolved_model = resolve_the_route_to_run_on({
    allowed_request,
    model_access,
    model_environment,
    saved_route_may_be_swapped: !requested_route,
    route_chosen_on_this_request: Boolean(requested_route) && !pick_was_coerced,
  });
  if (pick_was_coerced) {
    log.info(
      `${describe_model_request(model_request)} is locked for this workspace — running ${resolved_model.model_proxy}/${resolved_model.model_name} instead`,
      { workspace_id: config.workspace_id ?? null },
    );
  }
  const credential_origin: ModelCredentialOrigin = model_environment?.workspace_owned_env_names.has(
    resolved_model.credential_env_name,
  )
    ? 'workspace'
    : 'deployment';

  return {
    model_provider: resolved_model.model_provider,
    model_proxy: resolved_model.model_proxy,
    model_name: resolved_model.model_name,
    reasoning_level:
      resolved_model.reasoning_level ?? default_reasoning_level(config.nobody_is_waiting ?? false),
    credential_env_name: resolved_model.credential_env_name,
    credential_origin,
    ...(credential_origin === 'workspace' ? { api_key: resolved_model.api_key } : {}),
    ...(resolved_model.temperature === undefined
      ? {}
      : { temperature: resolved_model.temperature }),
    ...(resolved_model.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: resolved_model.max_output_tokens }),
  };
}

function resolve_the_route_to_run_on(input: {
  allowed_request: ModelRequest;
  model_access: ModelAccessRules;
  model_environment: WorkspaceModelEnvironment | undefined;
  saved_route_may_be_swapped: boolean;
  route_chosen_on_this_request: boolean;
}) {
  const { allowed_request, model_access, model_environment } = input;
  const resolve_route = (request: ModelRequest) =>
    resolve_runtime_llm_model(request, model_access, model_environment?.environment);
  const deployment_route = route_or_null_without_a_credential(() => resolve_route(allowed_request));
  const workspace_route = find_the_workspaces_own_route({
    resolved: deployment_route ?? route_the_deployment_cannot_serve(allowed_request),
    model_environment,
    route_chosen_on_this_request: input.route_chosen_on_this_request,
    model_access,
  });
  if (workspace_route) return resolve_route({ ...allowed_request, ...workspace_route });
  if (deployment_route) return deployment_route;

  const any_route = input.saved_route_may_be_swapped
    ? route_or_null_without_a_credential(() => resolve_route(any_model(allowed_request)))
    : null;
  return any_route ?? resolve_route(allowed_request);
}

function resolve_runtime_llm_model(
  model_request: ModelRequest,
  model_access: ModelAccessRules,
  environment?: LlmEnvironment,
) {
  const model_proxy =
    model_request.model_proxy ??
    (!model_request.model_name && model_request.model_provider
      ? find_model_proxy(model_request.model_provider)?.model_proxy
      : null);

  try {
    return resolve_llm_model(
      {
        use_case: 'agent_run',
        model_access,
        model_proxy,
        model_name: model_request.model_name,
        reasoning_level: model_request.reasoning_level,
        temperature: model_request.temperature,
        max_output_tokens: model_request.max_output_tokens,
      },
      environment,
    );
  } catch (error) {
    throw runtime_model_error(error, model_request);
  }
}
