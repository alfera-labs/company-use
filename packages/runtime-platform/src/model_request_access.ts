import type { LlmEnvironment } from '@agent-core/llm_gateway/model_resolver';
import type { RuntimeReasoningLevel } from '@agent-core/models/runtime_model_config';
import { env } from '@coworker/config';
import {
  find_model_proxy,
  find_model_proxy_credential,
  find_model_proxy_for_model_id,
  is_model_proxy_served_on_this_install,
  is_model_proxy_within_access,
  list_model_proxies_for_use_case_and_access,
  type ModelAccessRules,
  type ModelRouteInput,
  type NormalizedModelRoute,
  normalize_model_route,
  require_model_proxy,
  ValidationError,
} from '@coworker/shared';

export type ModelRequest = {
  model_provider: string | null;
  model_proxy: string | null;
  model_name: string | null;
  reasoning_level: RuntimeReasoningLevel | undefined;
  temperature: number | undefined;
  max_output_tokens: number | undefined;
};

/**
 * The route a request names, or null when it names none. A proxy that is not served on this
 * install is as unknown here as a name no proxy has.
 */
export function normalize_requested_model_route(request: ModelRouteInput) {
  if (!request.model_provider && !request.model_proxy && !request.model_name) return null;

  const normalized = normalize_model_route(request);
  if (normalized.success && normalized.route && is_served_here(normalized.route.model_proxy)) {
    return normalized.route;
  }
  const issues = find_model_route_issues(normalized);
  throw new ValidationError(
    issues.map((issue) => issue.message).join(' ') || 'The model route is invalid.',
    Object.fromEntries(issues.map((issue) => [issue.field, [issue.message]])),
  );
}

function is_served_here(proxy_name: string) {
  return is_model_proxy_served_on_this_install(require_model_proxy(proxy_name), env);
}

function find_model_route_issues(normalized: NormalizedModelRoute) {
  if (!normalized.success) return normalized.issues;
  if (!normalized.route) return [];
  return [
    { field: 'model_proxy', message: `Unknown model proxy: ${normalized.route.model_proxy}.` },
  ];
}

export function keep_the_request_within_access(
  model_request: ModelRequest,
  model_access: ModelAccessRules,
  environment: LlmEnvironment,
): ModelRequest {
  const proxy = find_the_requested_model_proxy(model_request);
  if (!proxy || is_model_proxy_within_access(proxy.model_proxy, model_access)) return model_request;
  const somewhere_to_send_it = list_model_proxies_for_use_case_and_access(
    'agent_run',
    model_access,
  ).some((candidate) => find_model_proxy_credential(candidate.model_proxy, environment));
  if (!somewhere_to_send_it) return model_request;

  return any_model(model_request);
}

/** Drops the saved model, so the first proxy that holds a credential serves the run. */
export function any_model(model_request: ModelRequest): ModelRequest {
  return { ...model_request, model_provider: null, model_proxy: null, model_name: null };
}

function find_the_requested_model_proxy(model_request: ModelRequest) {
  const proxy_name =
    model_request.model_proxy ?? (model_request.model_name ? null : model_request.model_provider);
  if (proxy_name) return find_model_proxy(proxy_name);

  return model_request.model_name
    ? find_model_proxy_for_model_id(model_request.model_name)
    : undefined;
}

export function describe_model_request(model_request: ModelRequest) {
  return (
    [model_request.model_proxy, model_request.model_name].filter(Boolean).join('/') ||
    (model_request.model_provider ?? 'the requested model')
  );
}
