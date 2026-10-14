import type { trigger_rule_operations } from '@coworker/core/access/trigger_rules';
import type { OnboardingCompanyScan } from '@coworker/core/db/queries/onboarding';
import type {
  ChoicesWaitData,
  ToolPolicyApprovalWaitData,
} from '@coworker/core/db/schema/approval_wait_data';
import type {
  ChannelConfigData,
  SlackChannelPolicyData,
  SlackThreadBackfillPolicyData,
} from '@coworker/core/db/schema/channel_config_data';
import {
  agent_heartbeat_config_key,
  type JsonSchema,
  type MessageContent,
  type SessionSourceActor,
  type SourceActor,
} from '@coworker/shared';

export type {
  ChoicesWaitData,
  ToolPolicyApprovalCallData,
  ToolPolicyApprovalGrantData,
  ToolPolicyApprovalWaitData,
  ToolPolicyApprovalWaitDataV2,
} from '@coworker/core/db/schema/approval_wait_data';
export type {
  AutomationConditions,
  AutomationJudge,
  AutomationRunPolicy,
  AutomationUsesTools,
  NotificationEvidence,
  NotificationProposedAction,
} from '@coworker/core/db/schema/automation_contracts';
export type { ChannelConfigData };

type OnboardingProfileData = {
  how_found_us?: string;
  role?: string;
  work_kind?: string;
  marketing_opt_in?: boolean;
  saved_at?: string;
};

export type UserData = Record<string, unknown> & {
  onboarding_profile?: OnboardingProfileData;
};

export type WorkspaceData = Record<string, unknown> & {
  onboarding?: {
    completed_at?: string;
    step?: string;
    channels_joined?: number;
    welcome_sent?: boolean;
    company_scan?: OnboardingCompanyScan;
  };
  slack_mirror?: {
    discovery_checkpoints?: Record<string, { last_scanned_ts?: string }>;
  };
  inbound_email?: {
    enabled?: boolean;
    attribution_enabled?: boolean;
    retired_usernames?: string[];
  };
  rewards?: RewardsData;
  api_access?: {
    requested_time?: string;
    note?: string;
  };
  model_billing?: {
    source?: 'own_account' | 'credits';
  };
  proactivity?: 'off' | 'quiet' | 'normal';
};

export type RewardsData = {
  quests?: Record<string, string>;
  referred_by_workspace_id?: string;
  card_unlocked_time?: string;
  trial_refusal?: { reason: 'prepaid_card' | 'card_already_used'; time: string } | null;
  card_setup_window?: { day: string; count: number };
};

export type SessionMetadata = Record<string, unknown> & {
  actors?: SessionSourceActor[];
  read_markers?: SessionReadMarkers;
  title_generation?: SessionTitleGeneration;
  approval_grants?: SessionApprovalGrant[];
};

type SessionReadMarkers = Record<string, number>;

export type SessionTitleGeneration = Record<string, unknown> & {
  source?: 'placeholder' | 'llm' | 'fallback' | 'user';
};

export type SessionApprovalGrant = {
  node_key: string;
  granted_by: string;
  granted_time: string;
};

export type SessionSourceMetadataData = Record<string, unknown> & {
  runtime_response_is_user_visible?: boolean;
  kind?: string;
  slack?: Record<string, unknown> & {
    team_id?: string;
    channel_id?: string;
    channel_type?: string;
    thread_ts?: string;
  };
};

export type ConnectionConfigData = Record<string, unknown> & {
  bot_token?: string;
  connection_access_type?: 'shared' | 'restricted';
  access?: Record<string, unknown> & {
    allowed_users?: Array<{
      user_id: string;
      can_delete?: boolean;
      can_edit_tools?: boolean;
    }>;
  };
  slack?: {
    channel_policy?: SlackChannelPolicyData;
    context_backfill?: SlackThreadBackfillPolicyData;
  };
};

export type ConnectionResumeIntentData = Record<string, unknown> & {
  session_id: string;
  batch_id?: string;
  actor_id?: string;
  instruction?: string;
  created_at?: string;
};

export type ConnectionSetupStateData = Record<string, unknown> & {
  type?: string;
  connection_id?: string;
  provider_key?: string;
  provider_app_id?: string;
  provider_app_key?: string | null;
  external_user_key?: string;
  setup_token?: string;
  setup_token_hash?: string;
  setup_token_expires_time?: string;
  setup_started_time?: string | Date;
  setup_session_id?: string;
  provider_webhook_token?: string;
  setup_strategy?: Record<string, unknown>;
  provider_auth_config_id?: string;
  provider_connected_account_id?: string;
  hosted_connect_link?: string | null;
  hosted_connect_expires_at?: string | null;
  oauth_client_id?: string | null;
  oauth_client_id_env?: string | null;
  oauth_client_secret_env?: string | null;
  oauth_authorization_url?: string;
  oauth_token_url?: string;
  oauth_token_auth_method?: string;
  oauth_token_request_format?: string;
  oauth_state_token?: string;
  oauth_state_expires_time?: string;
  oauth_scopes?: string[];
  oauth_scope_separator?: string;
  oauth_code_challenge?: string | null;
  oauth_code_challenge_method?: 'S256' | null;
  oauth_code_verifier?: string | null;
  oauth_authorization_params?: Record<string, string>;
  oauth_resource?: string | null;
  error_message?: string;
  redirect_uri?: string | null;
  resume?: ConnectionResumeIntentData;
  resume_disposition?: 'waiting' | 'postponed';
  resume_disposition_time?: string;
};

export type ProviderAccountData = Record<string, unknown> & {
  bot_user_id?: string;
  botUserId?: string;
  bot_id?: string;
  botId?: string;
  app_id?: string;
  api_app_id?: string;
  appId?: string;
  team_id?: string;
  bot_token?: string;
  access_token?: string;
  // Salesforce answers its token exchange with the org's own API host. It is a location, not a
  // secret, so it survives into provider_account and every call for that connection goes there.
  instance_url?: string;
  authProvisionId?: string;
  account_id?: string;
  externalUserId?: string;
  external_user_id?: string;
  authed_user?: Record<string, unknown> & { id?: string };
  connected_account_id?: string;
  auth_config_id?: string;
  auth_scheme?: string;
  toolkit_slug?: string;
  word_id?: string;
  identity?: { endpoint: string; data: unknown };
};

export type TriggerFieldChoiceSource = {
  action_node_name: string;
  items_path: readonly string[];
  value_path: readonly string[];
  label_path: readonly string[];
};

export type NodeConfigData = Record<string, unknown> & {
  sourced_from?: Record<string, unknown> & { provider_component_id?: string };
  field_choices?: { fingerprint: string; fields: Record<string, TriggerFieldChoiceSource> };
  subject_field?: string;
  proxy?: {
    method?: string | null;
    url_mode?: string | null;
    base_proxy_target_url?: string | null;
  };
  mcp?: {
    endpoint_url?: string;
  };
  composio?: {
    toolkit_slug?: string;
    tool_slug?: string;
    trigger_slug?: string;
    pinned_version?: string | null;
  };
  wire?: {
    provisioned_by?: TriggerWireProvisionerKey;
    trigger_slug?: string;
  };
};

export type AppConfigData = Record<string, unknown> & {
  add_to_every_request?: readonly (Record<string, unknown> & {
    when_the_request_goes_to: string;
    take_the_value_from: string;
  })[];
  api_protocol_headers?: Record<string, string>;
};

type EncryptedCredentialValueData = {
  envelope_version: 1 | 2;
  encryption: 'aes-256-gcm';
  key_id: string;
  salt?: string;
  nonce: string;
  ciphertext: string;
  auth_tag: string;
};

export type ConnectionCredentialData = Record<string, unknown> & {
  encrypted_values?: Record<string, EncryptedCredentialValueData>;
  metadata?: Record<string, unknown>;
  _provider_account_id?: string;
  authProvisionId?: string;
  _external_user_id?: string;
  bot_token?: string;
  access_token?: string;
};

export type ConnectionMetadataData = Record<string, unknown> & {
  account_id?: string;
  authProvisionId?: string;
  external_user_id?: string;
};

type ToolFieldData = Record<string, unknown> & {
  name?: string;
  type?: string;
  description?: string | null;
  format?: string;
  readOnly?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  secret?: boolean;
  sync?: boolean;
  accessMode?: string;
};

export type NodeMetadataData = Record<string, unknown> & {
  description?: string | null;
  category?: string;
  policy_delegates_to_catalog?: boolean;
  policy_exempt?: boolean;
  policy_labels?: string[];
  approval_display_fields?: string[];
  policy_target_reads_input_fields?: { node_key: string; tool_input: string };
  required_connection?: boolean;
  proxy_method?: string;
  configurable_props?: ToolFieldData[];
  tool_group?: ToolGroupData;
};

export type ToolGroupData = {
  group_key: string;
  title: string;
  description: string;
  position: number;
};

export type ApprovalPolicyData = Record<string, unknown> & {
  mode?: string;
};

type LooseRunMessageContentData = Record<string, unknown> & {
  type?: string | undefined;
  text?: string | undefined;
  data?: Record<string, unknown> | undefined;
  parts?: MessageContent['parts'];
};

export type ToolResultPointerContentData = {
  shape: 'run_message_v2';
  parts: Array<{ type: 'tool_result'; tool_call_id: string }>;
};

export type RunMessageContentData = MessageContent | LooseRunMessageContentData;

export type ScoutSourceData = {
  version?: 1;
  mode?: 'autonomous_agent';
  source_event_id?: string;
  observed_event_ids: string[];
};

/**
 * Mirrors task_authority_schema in services/scheduled_task_authority.ts, which is what validates
 * this column. The schema cannot be imported here: services read this file, not the other way.
 *
 * 'scheduled_task' is what the agent's own scheduling tool grants; the three start modes are what
 * a template install grants. All four mean the same thing — a human read this and said yes.
 */
export type ScheduledTaskAuthorityData = {
  version: 1;
  kind: 'scheduled_task' | 'you_ask' | 'on_a_schedule' | 'something_happens';
  granted_by_actor_id: string;
  granted_time: string;
  instruction_sha256: string;
  payload_sha256?: string | undefined;
  template_id?: string | undefined;
  template_version?: number | undefined;
  trigger_id?: string | undefined;
};

export type TriggerSourceData = Record<string, unknown> & {
  origin?: string;
  [agent_heartbeat_config_key]?: ScoutSourceData;
  delegated_authority?: ScheduledTaskAuthorityData;
};

export type TriggerRuleOperation = (typeof trigger_rule_operations)[number];

export type TriggerRule = {
  field: string;
  operation: TriggerRuleOperation;
  values?: string[] | undefined;
};

type TriggerWireProvisionerKey = 'composio' | 'attio';

export type TriggerConfigData = Record<string, unknown> & {
  starts_job_handler?: string;
  timezone?: string;
  webhook_secret?: string;
  provisioned_by?: TriggerWireProvisionerKey;
  provisioning_key?: string;
  // Which Attio object an Attio ear listens to, resolved from the slug the person picked at
  // provisioning time. Attio's own subscription filter takes object ids, never slugs.
  attio_object_id?: string;
  provisioning_error?: string;
  wire_missing_since?: string;
  needs_connection?: string;
  event_source?: {
    node_key: string;
    trigger_slug?: string;
    connection_id?: string;
    subscription_config?: Record<string, unknown>;
  };
  rules?: TriggerRule[];
  judge?: { question: string; run_at_or_above?: number };
  run_once_at?: string;
  job_input?: { instruction?: string; context_digest?: string };
  [agent_heartbeat_config_key]?: {
    version?: 1;
    mode?: 'autonomous_agent';
    max_output_tokens?: number;
    recent_message_limit?: number;
    max_actions?: number;
  };
};

export type SlackRawEventData = Record<string, unknown> & {
  type?: string | undefined;
  subtype?: string | undefined;
  team?: string | undefined;
  channel?: string | undefined;
  channel_type?: string | undefined;
  ts?: string | undefined;
  event_ts?: string | undefined;
  thread_ts?: string | undefined;
  user?: string | undefined;
  text?: string | undefined;
  bot_id?: string | undefined;
  files?: unknown;
  message?:
    | (Record<string, unknown> & {
        user?: string | undefined;
        text?: string | undefined;
        files?: unknown;
      })
    | undefined;
};

export type EventBodyData = Record<string, unknown> & {
  team_id?: string;
  channel_id?: string;
  event_ts?: string;
  thread_ts?: string;
  user_id?: string;
  raw_text?: string;
  text?: string;
  trigger_id?: string;
  instruction?: string;
  context_digest?: string;
  connection_id?: string;
  connection_resolution?: 'connected' | 'postponed' | 'cancelled' | 'expired';
  notification_channel_id?: string;
  resume?: ConnectionResumeIntentData;
};

export type EventRawPayloadData = Record<string, unknown> & {
  type?: string | undefined;
  challenge?: string | undefined;
  event_id?: string | undefined;
  team_id?: string | undefined;
  api_app_id?: string | undefined;
  event?: SlackRawEventData | undefined;
  authorizations?: Array<Record<string, unknown> & { team_id?: string | undefined }> | undefined;
};

export type EventJobResultData = Record<string, unknown> & {
  created?: number;
  skipped?: number;
  superseded?: number;
  progress?: {
    completed_unit_count?: number;
    total_unit_count?: number;
  };
  deletion?: {
    database_deleted: boolean;
    archive_deleted: boolean;
    deleted_fact_count: number;
    error_code: string | null;
  };
};

export type EventJobErrorData = Record<string, unknown> & {
  code?: string;
  message?: string;
};

export type EventJobMetadataData = Record<string, unknown> & {
  blocks_later_subject_jobs?: boolean;
  claimed_alone?: boolean;
  client_message_id?: string;
  preview_text?: string;
  attachment_count?: number;
  dismissed_by_user?: boolean;
  policy_approval?: ToolPolicyApprovalWaitData;
  choices_wait?: ChoicesWaitData;
  answer_taken_by_the_run_that_asked?: boolean;
};

export type FileMetadataData = Record<string, unknown> & {
  source_kind?: string;
  source_artifact_id?: string;
  external_url?: string;
};

type JsonSchemaProperty = NonNullable<JsonSchema['properties']>[string];

export type ToolInputPropertyData = Omit<JsonSchema, 'items' | 'properties'> &
  Record<string, unknown> & {
    field?: Record<string, unknown> & {
      file_reference?: {
        accepted_sources?: string[];
      };
    };
    items?: ToolInputPropertyData | ToolInputPropertyData[];
    properties?: Record<string, JsonSchemaProperty | ToolInputPropertyData> | undefined;
  };

export type NodeInputSchemaData = Omit<JsonSchema, 'properties'> & {
  field?: Record<string, unknown> | undefined;
  properties?: Record<string, JsonSchemaProperty | ToolInputPropertyData> | undefined;
};

export type SlackSourceMetadataData = Record<string, unknown> & {
  has_visible_text?: boolean;
  trigger_id?: string;
  optimistic?: boolean;
  visibility?: string;
  provider_metadata?: {
    stop_reason?: string;
  };
  source_actor?: SourceActor;
  slack?: Record<string, unknown> & {
    event_ts?: string;
    history_backfill?: boolean;
    channel_id?: string;
    user_id?: string;
  };
};

export type RunMetadataData = Record<string, unknown> & {
  turn_finalize?: Record<string, unknown> & { outcome?: string };
  turn_stream?: {
    provider?: string;
    message_id?: string;
  };
};

export type ToolInputData = Record<string, unknown> & {
  node_key?: string | undefined;
  keep_working?: boolean | undefined;
  resolution_type?: string | undefined;
  message?: string | undefined;
  channel_id?: string | undefined;
};

type EvalMissedToolCallData = {
  capability: string;
  reason: string;
  evidence: string[];
};

type EvalExecutionIssueData = {
  issue_type:
    | 'failed_tool_call'
    | 'blocked_tool_call'
    | 'unfinished_tool_call'
    | 'missed_tool_call'
    | 'slow_execution'
    | 'timeout'
    | 'dispatch_error'
    | 'grading_error';
  message: string;
  evidence: string[];
};

export type EvalExecutionScoresData = Record<string, unknown> & {
  schema_version: number;
  result_score: number;
  speed_score: number;
  tool_score: number;
  execution_score: number;
  end_to_end_duration_ms: number;
  internal_run_duration_ms: number;
  completed_tool_call_count: number;
  failed_tool_call_count: number;
  blocked_tool_call_count: number;
  unfinished_tool_call_count: number;
  missed_tool_calls: EvalMissedToolCallData[];
  execution_issues: EvalExecutionIssueData[];
};

export type EvalReportMetadataData = Record<string, unknown> & {
  task_rubric_fingerprint?: string;
  judge?: Record<string, unknown> & { score?: number };
  execution_scores?: EvalExecutionScoresData;
};

export type ConnectionProfileData = Record<string, unknown> & {
  connection_profile_key: string;
  version: number;
  status: string;
  auth_method_key: string;
  setup_strategy: Record<string, unknown>;
  runtime_credential_strategy: Record<string, unknown>;
  default_scopes: string[];
};

export type AppProviderConfigData = Record<string, unknown> & {
  provider_key: string;
  provider_config_key: string;
  version: number;
  status: string;
  provider_app_key?: string | undefined;
  setup_defaults: Record<string, unknown>;
  connection_profiles: ConnectionProfileData[];
};

export type AppMetadataData = Record<string, unknown> & {
  icon_url?: string;
  description?: string;
  source?: string;
  provider_configs?: AppProviderConfigData[];
  superseded_by_app_name?: string;
  mcp_admitted_server?: boolean;
  mcp_sync?: {
    last_synced_time?: string;
    tool_list_digest?: string | null;
    listed_tool_count?: number | null;
    last_error_message?: string | null;
  };
};

export type AppDisplayConfigData = Record<string, unknown> & {
  icon_url?: string;
  description?: string;
};

export type ConnectionSelectorData =
  | { strategy: 'no_connection_required' }
  | { strategy: 'specific_connection'; connection_id: string }
  | { strategy: 'latest_active_matching_connection' }
  | { strategy: 'connection_key'; connection_key: string };

export type AgentEnabledNodeData = {
  node_key: string;
  provider_key: 'native' | 'mcp' | 'composio' | 'custom_http';
  status: 'enabled' | 'disabled';
  connection_selector: ConnectionSelectorData;
  input_defaults: Record<string, unknown>;
  approval_policy_override: Record<string, unknown> | null;
};

export type VolumeConfigData = Record<string, unknown> & {
  storage_path?: string;
  storage_layout?: string;
  workspace_layout_version?: number;
};

export type AgentConfigData = Record<string, unknown> & {
  enabled_nodes?: Array<AgentEnabledNodeData | string>;
  model_proxy?: string | null;
};
