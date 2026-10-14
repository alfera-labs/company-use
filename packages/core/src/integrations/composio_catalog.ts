import type {
  AppMetadataData,
  AppProviderConfigData,
  ApprovalPolicyData,
  ConnectionProfileData,
  NodeConfigData,
  NodeInputSchemaData,
  NodeMetadataData,
} from '@coworker/core/db/schema/json_column_types';
import { build_api_proxy_input_schema } from '@coworker/core/integrations/api_proxy_input_schema';
import type {
  ComposioAuthConfigDetail,
  ComposioAuthField,
  ComposioTool,
  ComposioToolkitDetail,
  ComposioTriggerType,
} from '@coworker/core/integrations/composio_api_records';
import {
  build_composio_connection_profile_key,
  build_composio_provider_config_key,
  composio_approval_policy,
  composio_auth_method_keys,
  composio_auth_scheme_auth_type,
  composio_hosted_setup_strategy_type,
  composio_provider_key,
  composio_proxy_runtime_handler,
  composio_runtime_handler_prefix,
  composio_trigger_runtime_handler_prefix,
  translate_composio_output_schema,
  translate_composio_tool_schema,
} from '@coworker/core/integrations/composio_schema';
import { scopes_every_way_needs } from '@coworker/core/integrations/composio_scope_requirements';
import { fit_node_name } from '@coworker/core/integrations/provider_catalog_identity';
import { find_trigger_subject_field } from '@coworker/core/integrations/trigger_subject_fields';
import { build_node_key, normalize_machine_name } from '@coworker/shared';

export type ComposioAppSeed = {
  app_name: string;
  app_key: string;
  provider_app_key: string;
  app_display_name: string;
  app_category: string | null;
  auth_type: string;
  allowed_request_origins: string[];
  metadata: AppMetadataData;
};

export type ComposioNodeSeed = {
  app_name: string;
  app_key: string;
  provider_app_key: string;
  node_name: string;
  node_key: string;
  node_version: number;
  node_display_name: string;
  node_kind: string;
  input_schema: NodeInputSchemaData;
  output_schema: Record<string, unknown>;
  approval_policy: ApprovalPolicyData;
  runtime_handler: string;
  node_runtime: string;
  node_status: string;
  required_scopes: string[];
  node_config: NodeConfigData;
  metadata: NodeMetadataData;
};

export const composio_proxy_methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type ComposioProxyMethod = (typeof composio_proxy_methods)[number];

export const composio_unmanaged_oauth_disabled_reason =
  'Composio does not manage this OAuth app; a custom auth config with our own client id and secret is required.';

const auth_scheme_order_preference = ['OAUTH2', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'NO_AUTH'];

export function build_composio_provider_config(
  toolkit: ComposioToolkitDetail,
): AppProviderConfigData {
  const managed_schemes = toolkit.composio_managed_auth_schemes ?? [];
  const details = toolkit.auth_config_details ?? [];
  const schemes = details.length > 0 ? details.map((detail) => detail.mode) : managed_schemes;
  const connection_profiles = (schemes.length > 0 ? schemes : ['NO_AUTH'])
    .map((scheme) =>
      build_connection_profile({
        toolkit_slug: toolkit.slug,
        scheme,
        detail: details.find((detail) => detail.mode === scheme),
        managed: managed_schemes.includes(scheme),
      }),
    )
    .sort(compare_connection_profiles);

  return {
    provider_key: composio_provider_key,
    provider_config_key: build_composio_provider_config_key(toolkit.slug),
    version: 1,
    status: 'active',
    provider_app_key: toolkit.slug,
    setup_defaults: { user_id_strategy: 'workspace' },
    connection_profiles,
  };
}

export function composio_app_auth_type(config: AppProviderConfigData) {
  const active_profile = find_active_composio_profile(config);
  if (!active_profile) return 'none';
  return composio_auth_scheme_auth_type(read_profile_auth_scheme(active_profile));
}

export function find_active_composio_profile(config: AppProviderConfigData) {
  return config.connection_profiles.find((profile) => profile.status === 'active') ?? null;
}

export function build_composio_app_seed(input: {
  toolkit: ComposioToolkitDetail;
  app_name: string;
}): ComposioAppSeed {
  const { toolkit, app_name } = input;
  const provider_config = build_composio_provider_config(toolkit);
  const managed_schemes = toolkit.composio_managed_auth_schemes ?? [];
  const base_origin = read_static_base_origin(toolkit.base_url);
  const category_names = toolkit.meta.categories.map((category) => category.name);

  return {
    app_name,
    app_key: app_name,
    provider_app_key: toolkit.slug,
    app_display_name: toolkit.name,
    app_category: category_names[0] ?? null,
    auth_type: composio_app_auth_type(provider_config),
    allowed_request_origins: base_origin ? [base_origin] : [],
    metadata: {
      source: composio_provider_key,
      sourced_from: {
        provider: composio_provider_key,
        provider_app_id: toolkit.slug,
        provider_app_slug: toolkit.slug,
      },
      ...(toolkit.meta.description ? { description: toolkit.meta.description } : {}),
      ...(toolkit.meta.logo ? { icon_url: toolkit.meta.logo } : {}),
      categories: category_names,
      app_url: toolkit.meta.app_url ?? null,
      composio: {
        toolkit_version: toolkit.meta.version ?? null,
        tools_count: toolkit.meta.tools_count ?? null,
        triggers_count: toolkit.meta.triggers_count ?? null,
        auth_schemes: (toolkit.auth_config_details ?? []).map((detail) => detail.mode),
        composio_managed_auth_schemes: managed_schemes,
        base_url: toolkit.base_url ?? null,
      },
      auth_config: {
        auth_methods: provider_config.connection_profiles.map((profile) =>
          build_auth_method(toolkit.slug, profile, managed_schemes),
        ),
      },
      provider_configs: [provider_config],
    },
  };
}

export function composio_node_name(
  tool_slug: string,
  toolkit_slug: string,
  maximum_length: number,
) {
  const toolkit_prefix = `${toolkit_slug.toUpperCase()}_`;
  const action = tool_slug.startsWith(toolkit_prefix)
    ? tool_slug.slice(toolkit_prefix.length)
    : tool_slug;
  const normalized_name = normalize_machine_name(action.toLowerCase(), {
    maximum_length: Number.MAX_SAFE_INTEGER,
    fallback: 'node',
  });
  return fit_node_name(normalized_name, tool_slug, maximum_length);
}

export function build_composio_action_node_seed(input: {
  toolkit: ComposioToolkitDetail;
  tool: ComposioTool;
  app_name: string;
  node_name: string;
  synced_time?: Date;
}): ComposioNodeSeed {
  const { toolkit, tool, app_name, node_name } = input;

  return {
    ...node_identity({ app_name, node_name, provider_app_key: toolkit.slug }),
    node_display_name: tool.name,
    node_kind: 'action',
    input_schema: translate_composio_tool_schema(tool.input_parameters),
    output_schema: composio_output_schema(tool.output_parameters),
    approval_policy: composio_approval_policy(tool.tags),
    runtime_handler: `${composio_runtime_handler_prefix}${tool.slug}`,
    node_runtime: 'connected_app',
    node_status: tool.is_deprecated ? 'deprecated' : 'active',
    required_scopes: composio_required_scopes(tool),
    node_config: {
      sourced_from: composio_sourced_from({
        toolkit_slug: toolkit.slug,
        provider_component_id: tool.slug,
        provider_component_version: tool.version ?? null,
        synced_time: input.synced_time,
      }),
      composio: {
        toolkit_slug: toolkit.slug,
        tool_slug: tool.slug,
        pinned_version: null,
      },
    },
    metadata: {
      source: composio_provider_key,
      description: tool.description,
      category: composio_provider_key,
      app_name,
      required_connection: !tool.no_auth,
      annotations: { tags: tool.tags },
      human_description: tool.human_description ?? null,
      scopes: tool.scopes,
      scope_requirements: tool.scope_requirements ?? null,
      provider_definition: tool,
    },
  };
}

// `nodes.required_scopes` is a flat list the compatibility gate demands in full. Composio's
// `scopes` is a union of alternatives — GMAIL_SEND_EMAIL lists four scopes and needs any one —
// so copying it would refuse every Gmail connection. The full tree stays in
// `metadata.scope_requirements`. A legacy tool with no structure requires nothing here.
function composio_required_scopes(tool: Pick<ComposioTool, 'scope_requirements'>) {
  return tool.scope_requirements ? scopes_every_way_needs(tool.scope_requirements) : [];
}

const permissive_output_schema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
} as const;

function composio_output_schema(output_parameters: Record<string, unknown>) {
  const translated = translate_composio_output_schema(output_parameters);
  return Object.keys(translated).length > 0 ? translated : { ...permissive_output_schema };
}

const composio_proxy_url_description =
  'Target API URL. Use a full allowed URL or a relative path resolved against the app base URL.';

export function build_composio_proxy_node_seeds(input: {
  toolkit: ComposioToolkitDetail;
  app_name: string;
  maximum_length: number;
  synced_time?: Date;
}): ComposioNodeSeed[] {
  const base_proxy_target_url = read_static_base_url(input.toolkit.base_url);
  if (!base_proxy_target_url) return [];

  return composio_proxy_methods.map((method) =>
    build_composio_proxy_node_seed({ ...input, method, base_proxy_target_url }),
  );
}

export function build_composio_trigger_node_seed(input: {
  toolkit: ComposioToolkitDetail;
  trigger: ComposioTriggerType;
  app_name: string;
  node_name: string;
  synced_time?: Date;
}): ComposioNodeSeed {
  const { toolkit, trigger, app_name, node_name } = input;
  const output_schema = composio_output_schema(trigger.payload);
  const subject_field = find_trigger_subject_field({ trigger_slug: trigger.slug, output_schema });

  return {
    ...node_identity({ app_name, node_name, provider_app_key: toolkit.slug }),
    node_display_name: trigger.name,
    node_kind: 'trigger',
    input_schema: translate_composio_tool_schema(trigger.config),
    output_schema,
    approval_policy: { mode: 'none', reason: 'composio_trigger_definition' },
    runtime_handler: `${composio_trigger_runtime_handler_prefix}${trigger.slug}`,
    node_runtime: 'connected_app',
    node_status: 'active',
    required_scopes: [],
    node_config: {
      sourced_from: composio_sourced_from({
        toolkit_slug: toolkit.slug,
        provider_component_id: trigger.slug,
        provider_component_version: trigger.version ?? null,
        synced_time: input.synced_time,
      }),
      composio: { toolkit_slug: toolkit.slug, trigger_slug: trigger.slug },
      ...(subject_field ? { subject_field } : {}),
    },
    metadata: {
      source: composio_provider_key,
      description: trigger.description,
      category: composio_provider_key,
      app_name,
      required_connection: true,
      trigger_mechanism: trigger.type,
      instructions: trigger.instructions ?? null,
      provider_definition: trigger,
    },
  };
}

function build_connection_profile(input: {
  toolkit_slug: string;
  scheme: string;
  detail: ComposioAuthConfigDetail | undefined;
  managed: boolean;
}): ConnectionProfileData {
  const { toolkit_slug, scheme, detail, managed } = input;
  const auth_config_fields = detail?.fields?.auth_config_creation?.required ?? [];
  // API_KEY, BEARER_TOKEN, BASIC and NO_AUTH need no client credentials, so an auth config for
  // them can be created on demand even though Composio does not host the app.
  const disabled_reason =
    managed || auth_config_fields.length === 0 ? null : composio_unmanaged_oauth_disabled_reason;
  const initiation_fields = [
    ...(detail?.fields?.connected_account_initiation?.required ?? []),
    ...(detail?.fields?.connected_account_initiation?.optional ?? []),
  ];

  return {
    connection_profile_key: build_composio_connection_profile_key(toolkit_slug, scheme),
    version: 1,
    status: disabled_reason ? 'disabled' : 'active',
    auth_method_key: composio_auth_method_key(scheme, managed),
    setup_strategy: {
      type: composio_hosted_setup_strategy_type,
      auth_scheme: scheme,
      auth_config_source: managed ? 'composio_managed' : 'custom',
      connected_account_fields: initiation_fields.map(build_connected_account_field),
      ...(disabled_reason ? { disabled_reason } : {}),
    },
    runtime_credential_strategy: {
      type: 'provider_account_reference',
      send_to_provider_as: 'connected_account_id',
    },
    default_scopes: detail?.required_scopes ?? [],
  };
}

function composio_auth_method_key(scheme: string, managed: boolean) {
  const auth_type = composio_auth_scheme_auth_type(scheme);
  if (auth_type === 'none') return composio_auth_method_keys.none;
  if (managed && auth_type === 'oauth2') return composio_auth_method_keys.managed_oauth;
  return composio_auth_method_keys.custom_auth;
}

function build_connected_account_field(field: ComposioAuthField) {
  return {
    name: field.name,
    display_name: field.displayName ?? field.name,
    required: field.required === true,
    is_secret: field.is_secret === true,
    ...(field.description ? { description: field.description } : {}),
  };
}

function build_auth_method(
  toolkit_slug: string,
  profile: ConnectionProfileData,
  managed_schemes: readonly string[],
) {
  const auth_scheme = read_profile_auth_scheme(profile);
  return {
    auth_method_type: composio_auth_scheme_auth_type(auth_scheme),
    managed_by: managed_schemes.includes(auth_scheme) ? 'composio' : 'user_supplied',
    provider: { provider_type: composio_provider_key, provider_app_slug: toolkit_slug },
    auth_scheme,
  };
}

function compare_connection_profiles(left: ConnectionProfileData, right: ConnectionProfileData) {
  const status_difference = profile_status_rank(left) - profile_status_rank(right);
  if (status_difference !== 0) return status_difference;

  const left_scheme = read_profile_auth_scheme(left);
  const right_scheme = read_profile_auth_scheme(right);
  const preference_difference = auth_scheme_rank(left_scheme) - auth_scheme_rank(right_scheme);
  if (preference_difference !== 0) return preference_difference;
  return left_scheme.localeCompare(right_scheme);
}

function profile_status_rank(profile: ConnectionProfileData) {
  return profile.status === 'active' ? 0 : 1;
}

function auth_scheme_rank(auth_scheme: string) {
  const index = auth_scheme_order_preference.indexOf(auth_scheme);
  return index === -1 ? auth_scheme_order_preference.length : index;
}

function read_profile_auth_scheme(profile: ConnectionProfileData) {
  const auth_scheme = profile.setup_strategy.auth_scheme;
  return typeof auth_scheme === 'string' ? auth_scheme : 'NO_AUTH';
}

function node_identity(input: { app_name: string; node_name: string; provider_app_key: string }) {
  const node_version = 1;
  return {
    app_name: input.app_name,
    app_key: input.app_name,
    provider_app_key: input.provider_app_key,
    node_name: input.node_name,
    node_key: build_node_key({
      app_name: input.app_name,
      node_name: input.node_name,
      node_version,
    }),
    node_version,
  };
}

function composio_sourced_from(input: {
  toolkit_slug: string;
  provider_component_id: string;
  provider_component_version: string | null;
  synced_time?: Date | undefined;
}) {
  return {
    provider: composio_provider_key,
    provider_app_id: input.toolkit_slug,
    provider_component_id: input.provider_component_id,
    provider_component_version: input.provider_component_version,
    synced_from_catalog_time: (input.synced_time ?? new Date()).toISOString(),
  };
}

function build_composio_proxy_node_seed(input: {
  toolkit: ComposioToolkitDetail;
  app_name: string;
  maximum_length: number;
  method: ComposioProxyMethod;
  base_proxy_target_url: string;
  synced_time?: Date;
}): ComposioNodeSeed {
  const { toolkit, app_name, method } = input;
  const method_label = method.toUpperCase();
  const provider_component_id = `composio:api_proxy:${method}`;
  const node_name = fit_node_name(
    `${method}_api_proxy`,
    provider_component_id,
    input.maximum_length,
  );

  return {
    ...node_identity({ app_name, node_name, provider_app_key: toolkit.slug }),
    node_display_name: `${method_label} API proxy request`,
    node_kind: 'action',
    input_schema: build_api_proxy_input_schema({
      method,
      url_description: composio_proxy_url_description,
    }),
    output_schema: { ...permissive_output_schema },
    approval_policy:
      method === 'get'
        ? { mode: 'none', reason: 'composio_proxy_get_is_read' }
        : { mode: 'manual_review', reason: 'composio_proxy_can_modify_upstream_api' },
    runtime_handler: composio_proxy_runtime_handler,
    node_runtime: 'connected_app',
    node_status: 'active',
    required_scopes: [],
    node_config: {
      sourced_from: composio_sourced_from({
        toolkit_slug: toolkit.slug,
        provider_component_id,
        provider_component_version: null,
        synced_time: input.synced_time,
      }),
      composio: { toolkit_slug: toolkit.slug },
      proxy: {
        method,
        url_mode: 'static_domain',
        base_proxy_target_url: input.base_proxy_target_url,
      },
    },
    metadata: {
      source: composio_provider_key,
      description: `Send an authenticated ${method_label} request through Composio proxy execute for this app.`,
      category: 'composio_proxy',
      app_name,
      required_connection: true,
      proxy_enabled: true,
      proxy_method: method,
      proxy_url_mode: 'static_domain',
    },
  };
}

// A templated host (`https://{{subdomain}}.example.com`) is per-account, so it cannot be an
// allowed origin or a static proxy target.
function read_static_base_url(base_url: string | null | undefined) {
  if (!base_url || base_url.includes('{{')) return null;
  try {
    return new URL(base_url).protocol === 'https:' ? base_url : null;
  } catch {
    return null;
  }
}

function read_static_base_origin(base_url: string | null | undefined) {
  const static_base_url = read_static_base_url(base_url);
  return static_base_url ? new URL(static_base_url).origin : null;
}
