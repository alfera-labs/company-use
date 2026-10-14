import type { SessionEnv } from '@agent-core/environment';
import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import type {
  NodeInputSchemaData,
  ScheduledTaskAuthorityData,
  ScoutSourceData,
  ToolPolicyApprovalGrantData,
} from '@coworker/core/db/schema/json_column_types';
import type { IntegrationProviderKey } from '@coworker/core/integrations/provider_registry';
import {
  agent_heartbeat_config_key,
  type JsonSchema,
  type RuntimeToolResult,
  type SourceActor,
} from '@coworker/shared';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import type { z } from 'zod';

export type RuntimeToolSourceType = 'dashboard' | 'slack' | 'email' | 'api' | 'runtime' | 'tool';

type RuntimeToolSlackSourceMetadata = {
  connection_id?: string;
  configured_channel_id?: string;
  team_id?: string;
  channel_id?: string;
  channel_type?: string;
  event_ts?: string;
  thread_ts?: string;
  raw_thread_ts?: string;
  raw_text?: string;
  conversation_scope?: string;
  addressing_mode?:
    | 'direct_message'
    | 'explicit_mention'
    | 'thread_continuation'
    | 'channel_message';
  user_id?: string;
  turn_subject_key?: string;
  stream_message_ts?: string;
  history_backfill?: boolean;
};

export type RuntimeToolSourceMetadata = Record<string, unknown> & {
  source_actor?: SourceActor & { external_user_id?: string };
  slack?: RuntimeToolSlackSourceMetadata;
  email?: RuntimeToolEmailSourceMetadata;
  [agent_heartbeat_config_key]?: ScoutSourceData;
  delegated_authority?: ScheduledTaskAuthorityData;
  local_timezone?: string;
  policy_approval?: ToolPolicyApprovalGrantData;
};

type RuntimeToolEmailSourceMetadata = {
  email_id?: string | undefined;
  workspace_address?: string | undefined;
  from?: string | undefined;
  reply_to_email?: string | undefined;
  reply_cc?: string[] | undefined;
  sender_is_workspace_member?: boolean | undefined;
  reply_expected?: boolean | undefined;
  subject?: string | undefined;
  message_id?: string | undefined;
  references?: string[] | undefined;
};

export type RuntimeToolSourceContext = {
  source_type?: RuntimeToolSourceType;
  source_metadata?: RuntimeToolSourceMetadata;
};

export type RuntimeCatalogToolInput = Record<string, unknown> & {
  source_event_id?: string | undefined;
  channel_id?: string | undefined;
  thread_ts?: string | undefined;
  limit?: number | undefined;
  hours_back?: number | undefined;
  cursor?: string | undefined;
  include_bots?: boolean | undefined;
  file_id?: string | undefined;
  message?: string | undefined;
  blocks?: Record<string, unknown>[] | undefined;
  reply_broadcast?: boolean | undefined;
  file_path?: string | undefined;
  filename?: string | undefined;
  title?: string | undefined;
  initial_comment?: string | undefined;
  alt_text?: string | undefined;
};

type RuntimeToolSourceContextPolicy = {
  mode: 'current_turn';
};

export type RuntimeToolSpeaker = {
  source_actor_id: string;
  name: string;
  email?: string;
};

export type RuntimeToolExecutionContext = {
  db: Database;
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  tool_call_id?: string;
  actor_id: string;
  participants?: Participants;
  room_private_to?: string | null | undefined;
  tool_context_metadata?: Readonly<Record<string, unknown>>;
  environment?: SessionEnv;
  allowed_tool_names?: readonly string[];
  attachment_sources?: ReadonlyMap<string, RuntimeAttachmentSource>;
  source_context?: RuntimeToolSourceContext;
  speaker?: RuntimeToolSpeaker;
  signal?: AbortSignal;
};

export type RuntimeToolConnectionProfile = {
  provider_key: IntegrationProviderKey;
  provider_config_key: string;
  connection_profile_key: string;
  auth_method_key: string;
  setup_strategy: Record<string, unknown>;
  runtime_credential_strategy: Record<string, unknown>;
  default_scopes: string[];
};

export type RuntimeToolDefinition<InputSchema extends z.ZodType = z.ZodType> = {
  node_key: string;
  node_name: string;
  display_name: string;
  description: string;
  category: string;
  input_schema: NodeInputSchemaData;
  output_schema: JsonSchema;
  app_name: string;
  required_connection: boolean;
  connection_profile?: RuntimeToolConnectionProfile;
  required_scopes?: string[];
  runtime_handler: string;
  approval_policy: Record<string, unknown>;
  source_context_policy?: RuntimeToolSourceContextPolicy;
  available_on_source_types?: RuntimeToolSourceType[];
  metadata: Record<string, unknown>;
  ends_run_on_success?: boolean;
  waits_for_a_person?: boolean;
  policy_timeout_ms?: (input: z.infer<InputSchema>) => number;
  find_policy_connection_id?: (
    db: Database,
    request: {
      workspace_id: string;
      tool_input: unknown;
      participants?: Participants | undefined;
      room_private_to?: string | null | undefined;
    },
  ) => Promise<string | null>;
  validate_input: InputSchema;
  execute: (
    input: z.infer<InputSchema>,
    context?: RuntimeToolExecutionContext,
  ) => Promise<RuntimeToolResult>;
};
