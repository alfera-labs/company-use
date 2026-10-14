import type { ModelReasoningLevel } from '@coworker/shared';
import type { InferResponseType } from 'hono/client';
import type {
  agent_enabled_nodes_client,
  api_client,
  artifact_content_client,
  run_chat_stream_events_client,
  run_inspection_client,
  run_tool_calls_client,
  session_by_id_client,
  session_queued_messages_client,
  session_sandbox_previews_client,
  session_stream_ticket_client,
  workspace_file_content_client,
  workspace_files_client,
} from '@/lib/api/client';

type ApiData<T> = T extends { data: infer Data } ? Data : never;
export type ApiSuccess<T> = ApiData<InferResponseType<T, 200 | 201>>;
export type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never;

export type Workspace = ApiSuccess<typeof api_client.v1.workspace.$get>;
export type WorkspaceSummary = ArrayItem<
  ApiSuccess<typeof api_client.v1.workspaces.$get>['workspaces']
>;
export type WorkspaceEmailAddress = ApiSuccess<
  (typeof api_client.v1.workspace)['email-address']['$get']
>;
export type ModelCatalogEntry = ArrayItem<ApiSuccess<typeof api_client.v1.models.$get>>;
export type Session = ArrayItem<ApiSuccess<typeof api_client.v1.sessions.$get>>;
export type SessionMessageMatch = ArrayItem<ApiSuccess<typeof api_client.v1.sessions.search.$get>>;
export type Agent = ArrayItem<ApiSuccess<typeof api_client.v1.agents.$get>>;
export type Run = ArrayItem<ApiSuccess<typeof session_by_id_client.runs.$get>>;
export type QueuedSessionMessage = ArrayItem<
  ApiSuccess<typeof session_queued_messages_client.$get>
>;
export type SentSessionMessage =
  InferResponseType<typeof session_queued_messages_client.$post, 200 | 202> extends {
    data: infer Data;
  }
    ? Data
    : never;
export type SessionStreamTicket = ApiSuccess<typeof session_stream_ticket_client.$post>;
export type RunMessagePage = ApiSuccess<typeof session_by_id_client.messages.$get>;
export type RunMessage = ArrayItem<RunMessagePage['items']>;
export type SandboxUrlPreview = ArrayItem<ApiSuccess<typeof session_sandbox_previews_client.$get>>;
export type RunInspection = ApiSuccess<typeof run_inspection_client.$get>;
export type ChatStreamEvent = ArrayItem<ApiSuccess<typeof run_chat_stream_events_client.$get>>;
export type ToolCall = ArrayItem<ApiSuccess<typeof run_tool_calls_client.$get>>;
export type ArtifactContent = ApiSuccess<typeof artifact_content_client.$get>;
export type WorkspaceFilesFolder = ApiSuccess<typeof workspace_files_client.$get>;
export type WorkspaceFolderEntry = ArrayItem<WorkspaceFilesFolder['folders']>;
export type WorkspaceFileEntry = ArrayItem<WorkspaceFilesFolder['files']>;
export type WorkspaceFileContent = ApiSuccess<typeof workspace_file_content_client.$get>;
export type CatalogApp = ArrayItem<ApiSuccess<typeof api_client.v1.apps.$get>>;
export type IntegrationApp = Pick<
  CatalogApp,
  | 'app_id'
  | 'app_name'
  | 'app_key'
  | 'app_display_name'
  | 'app_category'
  | 'auth_type'
  | 'display_config'
  | 'metadata'
>;
export type CatalogAppSearchResult = ApiSuccess<typeof api_client.v1.apps.search.$get>;
export type CatalogNode = ArrayItem<ApiSuccess<typeof api_client.v1.nodes.$get>>;
export type Connection = ArrayItem<ApiSuccess<typeof api_client.v1.connections.$get>>;
export type ConnectionTool = ArrayItem<
  ApiSuccess<(typeof api_client.v1.connections)[':connection_id']['tools']['$get']>
>;
export type Trigger = ArrayItem<ApiSuccess<typeof api_client.v1.triggers.$get>>;
export type TriggerStatus = 'enabled' | 'disabled' | 'error';
export type AgentEnabledNode = ArrayItem<ApiSuccess<typeof agent_enabled_nodes_client.$get>>;

type ApiKeyListClient = (typeof api_client.v1)['api-keys']['$get'];
type ApiKeyMintClient = (typeof api_client.v1)['api-keys']['$post'];
export type ApiKey = ArrayItem<ApiSuccess<ApiKeyListClient>>;
export type MintedApiKey = ApiSuccess<ApiKeyMintClient>;
export type ApiKeyScope = ApiKey['scopes'][number];
export type ApiKeyAudience = ApiKey['key_audience'];

export type ConnectionSetupState = {
  type?: string;
  connection_id?: string;
  external_user_key?: string;
  redirect_uri?: string | null;
  hosted_connect_link?: string | null;
  hosted_connect_expires_at?: string | null;
  authorization_url?: string | null;
  setup_error?: string | null;
};
export type ConnectionSetupResult = {
  connection: Connection;
  setup: ConnectionSetupState;
  start_url: string | null;
  tools_read_again?: { tool_count: number };
};

export type {
  AddedMcpServer,
  InspectedMcpServer,
  McpAuthenticationMode,
} from '@/lib/api/mcp_server_types';

export type OnboardingProfileInput = {
  how_found_us?: string;
  role?: string;
  work_kind?: string;
  marketing_opt_in?: boolean;
};

export type OnboardingSnapshot = ApiSuccess<typeof api_client.v1.onboarding.$get>;
export type OnboardingRecord = ApiSuccess<typeof api_client.v1.onboarding.step.$post>;
export type OnboardingCompletion = ApiSuccess<typeof api_client.v1.onboarding.complete.$post>;
export type OnboardingWelcomeResult = ApiSuccess<typeof api_client.v1.onboarding.welcome.$post>;
export type DevOnboardingSkip = ApiSuccess<(typeof api_client.v1.onboarding)['dev-skip']['$post']>;
export type OnboardingProfile = NonNullable<OnboardingSnapshot['profile']>;
export type SaveOnboardingProfileResult = ApiSuccess<typeof api_client.v1.onboarding.profile.$post>;
export type SlackConnectResult = ApiSuccess<typeof api_client.v1.slack.connect.$post>;
export type SlackChannelPage = ApiSuccess<typeof api_client.v1.slack.channels.$get>;
export type SlackChannelSummary = SlackChannelPage['channels'][number];
export type JoinSlackChannelsResult = ApiSuccess<typeof api_client.v1.slack.channels.join.$post>;
export type SlackChannelSettingsVisibility = 'public' | 'private';
type SlackChannelSettingsClient = (typeof api_client.v1.slack)['channel-settings']['$get'];
export type SlackChannelSettingsPage = ApiSuccess<SlackChannelSettingsClient>;
type SlackChannelAccessClient =
  (typeof api_client.v1.slack)['channel-settings'][':channel_id']['$put'];
export type SlackChannelAccessResult = ApiSuccess<SlackChannelAccessClient>;
type ProjectChannelsClient = (typeof api_client.v1.projects)[':project_id']['channels']['$get'];
export type ProjectChannel = ArrayItem<ApiSuccess<ProjectChannelsClient>>;

type PoliciesClient = (typeof api_client.v1)['policies'];
type ApprovalsClient = (typeof api_client.v1)['approvals'];
export type ToolPolicy = ArrayItem<ApiSuccess<PoliciesClient['$get']>>;
export type ToolApproval = ArrayItem<ApiSuccess<ApprovalsClient['$get']>>;
export type OpenChoicesWait = NonNullable<
  ApiSuccess<(typeof api_client.v1)['choices']['open']['$get']>
>;
export type ToolPolicyMode = 'allow' | 'ask' | 'never';
export type ToolPolicyScopeType = 'workspace' | 'connection' | 'project' | 'agent' | 'user';

export type SessionMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      data: string;
      mime_type: string;
      detail?: 'auto' | 'low' | 'high';
      source?: string;
    }
  | {
      type: 'file';
      file_id?: string;
      path?: string;
      url?: string;
      name?: string;
      mime_type?: string;
      text?: string;
      read_as?: 'image' | 'text';
      detail?: 'auto' | 'low' | 'high';
    };

export type SessionMessagePayload = {
  message?: string;
  content?: SessionMessagePart[];
  images?: Extract<SessionMessagePart, { type: 'image' }>[];
  model_provider?: string;
  model_proxy?: string;
  model_name?: string;
  reasoning_level?: ModelReasoningLevel;
  temperature?: number;
  max_output_tokens?: number;
};

export type RuntimeRunEvent = {
  event_type: string;
  run_key: string;
  event_id?: string;
  event_sequence?: number;
  delta?: string;
  accumulated_text?: string;
  label?: string;
  content?: unknown;
  content_index?: number;
  metadata?: Record<string, unknown>;
};

export type AgentRunStreamEvent =
  | { type: 'run_created'; run: Run }
  | { type: 'run_updated'; run: Run }
  | { type: 'message_created'; message: RunMessage }
  | ({ type: 'chat_event' } & ChatStreamEvent)
  | { type: 'runtime_event'; event: RuntimeRunEvent }
  | { type: 'done'; ok: true }
  | { type: 'error'; code?: string; message: string };

export type { Project, ProjectMember, ProjectMembership } from '@/lib/api/project_types';
