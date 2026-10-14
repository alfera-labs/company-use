import { composio_scope_requirements_schema } from '@coworker/core/integrations/composio_scope_requirements';
import { z } from 'zod';

export const composio_api_base_url = 'https://backend.composio.dev/api/v3.1';

// Unknown schemes still parse: Composio adds schemes without notice and a catalog sync must not
// fall over because one toolkit uses a new one. Callers treat anything outside the known list as
// "not offered".
const auth_scheme_schema = z.string();

const composio_connected_account_statuses = [
  'INITIALIZING',
  'INITIATED',
  'ACTIVE',
  'FAILED',
  'EXPIRED',
  'INACTIVE',
  'REVOKED',
] as const;

const page_schema = z
  .object({
    next_cursor: z.string().nullish(),
    total_pages: z.number().optional(),
    current_page: z.number().optional(),
    total_items: z.number().optional(),
  })
  .passthrough();

// Composio sends null where a field has no value (`scopes: null` on 900+ tools). Zod's `.default`
// fills undefined only, so one null failed the whole page. Null and undefined both take the default.
function null_as<T extends z.ZodTypeAny>(value: z.output<T>, schema: T) {
  return schema.nullish().transform((parsed) => parsed ?? value);
}

export function composio_page_schema<T extends z.ZodTypeAny>(item: T) {
  return page_schema.extend({ items: z.array(item) });
}

const composio_toolkit_category_schema = z
  .object({
    // The list endpoint answers `id`, the detail endpoint answers `slug`. Same value.
    id: z.string().optional(),
    slug: z.string().optional(),
    name: z.string(),
  })
  .passthrough();

const composio_toolkit_meta_schema = z
  .object({
    description: z.string().nullish(),
    logo: z.string().nullish(),
    app_url: z.string().nullish(),
    categories: null_as([], z.array(composio_toolkit_category_schema)),
    tools_count: z.number().optional(),
    triggers_count: z.number().optional(),
    version: z.string().nullish(),
    available_versions: z.array(z.string()).optional(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();

export const composio_toolkit_summary_schema = z
  .object({
    slug: z.string(),
    name: z.string(),
    type: z.enum(['native', 'custom']).optional(),
    auth_schemes: z.array(auth_scheme_schema).nullish(),
    composio_managed_auth_schemes: z.array(auth_scheme_schema).nullish(),
    no_auth: z.boolean().nullish(),
    auth_guide_url: z.string().nullish(),
    meta: composio_toolkit_meta_schema,
  })
  .passthrough();

const composio_auth_field_schema = z
  .object({
    name: z.string(),
    displayName: z.string().optional(),
    type: z.string().optional(),
    description: z.string().nullish(),
    default: z.unknown().optional(),
    required: z.boolean().optional(),
    is_secret: z.boolean().optional(),
    user_visible: z.boolean().optional(),
  })
  .passthrough();

export type ComposioAuthField = z.infer<typeof composio_auth_field_schema>;

const auth_field_group_schema = z
  .object({
    required: null_as([], z.array(composio_auth_field_schema)),
    optional: null_as([], z.array(composio_auth_field_schema)),
  })
  .passthrough();

const composio_auth_config_detail_schema = z
  .object({
    name: z.string().optional(),
    mode: auth_scheme_schema,
    required_scopes: null_as([], z.array(z.string())),
    fields: z
      .object({
        auth_config_creation: auth_field_group_schema.optional(),
        connected_account_initiation: auth_field_group_schema.optional(),
      })
      .passthrough()
      .optional(),
    proxy: z.object({ base_url: z.string() }).passthrough().optional(),
    auth_hint_url: z.string().nullish(),
  })
  .passthrough();

export type ComposioAuthConfigDetail = z.infer<typeof composio_auth_config_detail_schema>;

export const composio_toolkit_detail_schema = z
  .object({
    slug: z.string(),
    name: z.string(),
    type: z.enum(['native', 'custom']).optional(),
    enabled: z.boolean().optional(),
    composio_managed_auth_schemes: z.array(auth_scheme_schema).nullish(),
    composio_managed_auth: z
      .array(
        z
          .object({
            mode: auth_scheme_schema,
            scopes: z
              .object({ available: null_as([], z.array(z.string())) })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .nullish(),
    auth_config_details: z.array(composio_auth_config_detail_schema).nullish(),
    auth_guide_url: z.string().nullish(),
    base_url: z.string().nullish(),
    get_current_user_endpoint: z.string().nullish(),
    get_current_user_endpoint_method: z.string().nullish(),
    meta: composio_toolkit_meta_schema,
  })
  .passthrough();

export type ComposioToolkitDetail = z.infer<typeof composio_toolkit_detail_schema>;

const json_schema_record_schema = z.record(z.string(), z.unknown());

export const composio_tool_schema = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: null_as('', z.string()),
    human_description: z.string().nullish(),
    toolkit: z
      .object({ slug: z.string(), name: z.string().optional(), logo: z.string().nullish() })
      .passthrough(),
    input_parameters: null_as({}, json_schema_record_schema),
    output_parameters: null_as({}, json_schema_record_schema),
    no_auth: null_as(false, z.boolean()),
    version: z.string().nullish(),
    available_versions: null_as([], z.array(z.string())),
    scopes: null_as([], z.array(z.string())),
    // `scopes` is a flat union of every alternative. The structure that says which of them the
    // tool truly needs is here. Null on legacy tools that only expose the flat list.
    scope_requirements: composio_scope_requirements_schema.nullish(),
    tags: null_as([], z.array(z.string())),
    is_deprecated: null_as(false, z.boolean()),
  })
  .passthrough();

export type ComposioTool = z.infer<typeof composio_tool_schema>;

export const composio_trigger_type_schema = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: null_as('', z.string()),
    instructions: z.string().nullish(),
    type: z.enum(['webhook', 'poll']),
    toolkit: z
      .object({ slug: z.string(), name: z.string().optional(), logo: z.string().nullish() })
      .passthrough(),
    config: null_as({}, json_schema_record_schema),
    payload: null_as({}, json_schema_record_schema),
    version: z.string().nullish(),
    requires_webhook_endpoint_setup: z.boolean().optional(),
  })
  .passthrough();

export type ComposioTriggerType = z.infer<typeof composio_trigger_type_schema>;

export const composio_auth_config_schema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    type: z.enum(['default', 'custom']).optional(),
    toolkit: z.object({ slug: z.string() }).passthrough(),
    auth_scheme: auth_scheme_schema.nullish(),
    is_composio_managed: z.boolean().optional(),
    status: z.enum(['ENABLED', 'DISABLED']).optional(),
    no_of_connections: z.number().optional(),
    expected_input_fields: z.array(composio_auth_field_schema).optional(),
  })
  .passthrough();

export type ComposioAuthConfig = z.infer<typeof composio_auth_config_schema>;

export const composio_created_auth_config_schema = z
  .object({
    toolkit: z.object({ slug: z.string() }).passthrough(),
    auth_config: z
      .object({
        id: z.string(),
        auth_scheme: auth_scheme_schema,
        is_composio_managed: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

export const composio_connect_link_schema = z
  .object({
    link_token: z.string(),
    redirect_url: z.string(),
    expires_at: z.string(),
    connected_account_id: z.string(),
  })
  .passthrough();

export const composio_connected_account_schema = z
  .object({
    id: z.string(),
    toolkit: z.object({ slug: z.string() }).passthrough(),
    auth_config: z
      .object({
        id: z.string(),
        auth_scheme: auth_scheme_schema.optional(),
        is_composio_managed: z.boolean().optional(),
        is_disabled: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    status: z.enum(composio_connected_account_statuses),
    status_reason: z.string().nullish(),
    word_id: z.string().nullish(),
    alias: z.string().nullish(),
    user_id: z.string().nullish(),
    is_disabled: z.boolean().optional(),
    state: z
      .object({
        authScheme: auth_scheme_schema.optional(),
        val: z
          .object({ scope: z.union([z.string(), z.array(z.string())]).nullish() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    requested_scopes: z.array(z.string()).nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();

export type ComposioConnectedAccount = z.infer<typeof composio_connected_account_schema>;

export const composio_execute_result_schema = z
  .object({
    successful: z.boolean(),
    data: z.unknown().default({}),
    error: z.string().nullish(),
    log_id: z.string().nullish(),
  })
  .passthrough();

export type ComposioExecuteResult = z.infer<typeof composio_execute_result_schema>;

export const composio_proxy_result_schema = z
  .object({
    status: z.number(),
    data: z.unknown().optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    binary_data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const composio_file_upload_request_schema = z
  .object({
    id: z.string(),
    key: z.string(),
    new_presigned_url: z.string(),
  })
  .passthrough();

export const composio_trigger_instance_schema = z
  .object({
    id: z.string(),
    connected_account_id: z.string(),
    trigger_name: z.string(),
    user_id: z.string().optional(),
    trigger_config: null_as({}, z.record(z.string(), z.unknown())),
    disabled_at: z.string().nullish(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const composio_error_body_schema = z
  .object({
    error: z
      .object({
        message: z.string(),
        status: z.number().optional(),
        request_id: z.string().optional(),
        suggested_fix: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();
