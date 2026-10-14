import {
  ApiError,
  agent_by_id_client,
  agent_enabled_nodes_client,
  api_client,
  api_fetch,
  api_url,
  artifact_content_client,
  connection_by_id_client,
  no_store_request,
  read_api_data,
  run_by_id_client,
  run_chat_stream_events_client,
  run_inspection_client,
  run_tool_calls_client,
  session_by_id_client,
  session_queued_messages_client,
  session_sandbox_previews_client,
  session_stream_ticket_client,
  session_tool_calls_client,
  workspace_file_content_client,
  workspace_files_client,
} from '@/lib/api/client';
import type { CompanyScanResult } from '@/lib/api/company_scan';
import type {
  AddedMcpServer,
  Agent,
  AgentEnabledNode,
  ApiKey,
  ApiKeyAudience,
  ApiKeyScope,
  ArtifactContent,
  CatalogApp,
  CatalogAppSearchResult,
  CatalogNode,
  ChatStreamEvent,
  Connection,
  ConnectionSetupResult,
  ConnectionTool,
  DevOnboardingSkip,
  InspectedMcpServer,
  JoinSlackChannelsResult,
  McpAuthenticationMode,
  MintedApiKey,
  ModelCatalogEntry,
  OnboardingCompletion,
  OnboardingProfileInput,
  OnboardingRecord,
  OnboardingSnapshot,
  OnboardingWelcomeResult,
  OpenChoicesWait,
  Project,
  ProjectChannel,
  ProjectMember,
  ProjectMembership,
  QueuedSessionMessage,
  Run,
  RunInspection,
  RunMessagePage,
  SandboxUrlPreview,
  SaveOnboardingProfileResult,
  SentSessionMessage,
  Session,
  SessionMessageMatch,
  SessionMessagePayload,
  SessionStreamTicket,
  SlackChannelAccessResult,
  SlackChannelPage,
  SlackChannelSettingsPage,
  SlackChannelSettingsVisibility,
  SlackConnectResult,
  ToolApproval,
  ToolCall,
  ToolPolicy,
  ToolPolicyMode,
  ToolPolicyScopeType,
  Trigger,
  TriggerStatus,
  Workspace,
  WorkspaceEmailAddress,
  WorkspaceFileContent,
  WorkspaceFilesFolder,
  WorkspaceSummary,
} from '@/lib/api/types';
import { read_file_content_version } from '@/lib/file_content_version';

export * from '@/lib/api/model_provider_accounts';

export async function list_tool_policies(input: {
  scope_type: ToolPolicyScopeType;
  scope_id: string;
  resource_type?: string;
  limit?: number;
}): Promise<ToolPolicy[]> {
  return read_api_data<ToolPolicy[]>(
    await api_client.v1.policies.$get(
      {
        query: {
          scope_type: input.scope_type,
          scope_id: input.scope_id,
          ...(input.resource_type ? { resource_type: input.resource_type } : {}),
          ...(input.limit ? { limit: String(input.limit) } : {}),
        },
      },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/policies' },
  );
}

export async function change_tool_policies(input: {
  scope_type: ToolPolicyScopeType;
  scope_id: string;
  delete_policy_ids: string[];
  set_policies: Array<{
    resource_type: string;
    resource_id: string;
    policy_mode: ToolPolicyMode;
  }>;
}): Promise<{ deleted: ToolPolicy[]; written: ToolPolicy[] }> {
  return read_api_data(await api_client.v1.policies.batch.$put({ json: input }), {
    method: 'PUT',
    path: '/v1/policies/batch',
  });
}

export async function set_tool_policy(input: {
  resource_type: string;
  resource_id: string;
  scope_type: ToolPolicyScopeType;
  scope_id: string;
  policy_mode: ToolPolicyMode;
}): Promise<ToolPolicy> {
  return read_api_data<ToolPolicy>(await api_client.v1.policies.$put({ json: input }), {
    method: 'PUT',
    path: '/v1/policies',
  });
}

export async function delete_tool_policy(policy_id: string): Promise<ToolPolicy> {
  return read_api_data<ToolPolicy>(
    await api_client.v1.policies[':policy_id'].$delete({ param: { policy_id } }),
    { method: 'DELETE', path: `/v1/policies/${policy_id}` },
  );
}

export async function list_tool_approvals(): Promise<ToolApproval[]> {
  return read_api_data<ToolApproval[]>(
    await api_client.v1.approvals.$get({ query: { status: 'waiting' } }, no_store_request),
    { method: 'GET', path: '/v1/approvals' },
  );
}

export type ToolApprovalAnswer = {
  decision: 'approved' | 'denied';
  always_allow_subject?: string | undefined;
  always_allow_tools?: boolean | undefined;
};

export async function decide_tool_approval(
  job_id: string,
  answer: ToolApprovalAnswer,
): Promise<unknown> {
  return read_api_data(
    await api_client.v1.approvals[':job_id'].decision.$post({
      param: { job_id },
      json: {
        decision: answer.decision,
        ...(answer.always_allow_subject
          ? { always_allow_subject: answer.always_allow_subject }
          : {}),
        ...(answer.always_allow_tools ? { always_allow_tools: true } : {}),
      },
    }),
    { method: 'POST', path: `/v1/approvals/${job_id}/decision` },
  );
}

export async function get_open_choices_wait(session_id: string): Promise<OpenChoicesWait | null> {
  return read_api_data<OpenChoicesWait | null>(
    await api_client.v1.choices.open.$get({ query: { session_id } }, no_store_request),
    { method: 'GET', path: '/v1/choices/open' },
  );
}

export async function answer_open_choices(
  job_id: string,
  answer_text: string,
): Promise<{ answered: boolean }> {
  return read_api_data<{ answered: boolean }>(
    await api_client.v1.choices[':job_id'].answer.$post({
      param: { job_id },
      json: { answer_text },
    }),
    { method: 'POST', path: `/v1/choices/${job_id}/answer` },
  );
}

export async function get_current_workspace(): Promise<Workspace> {
  return read_api_data<Workspace>(await api_client.v1.workspace.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/workspace',
  });
}

export async function get_workspaces(): Promise<WorkspaceSummary[]> {
  const result = await read_api_data<{ workspaces: WorkspaceSummary[] }>(
    await api_client.v1.workspaces.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/workspaces' },
  );
  return result.workspaces;
}

export async function rename_workspace(workspace_name: string): Promise<Workspace> {
  return read_api_data<Workspace>(
    await api_client.v1.workspace.$patch({ json: { workspace_name } }),
    { method: 'PATCH', path: '/v1/workspace' },
  );
}

export async function get_workspace_email_address(): Promise<WorkspaceEmailAddress> {
  return read_api_data<WorkspaceEmailAddress>(
    await api_client.v1.workspace['email-address'].$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/workspace/email-address' },
  );
}

export async function create_workspace_email_address(): Promise<WorkspaceEmailAddress> {
  return read_api_data<WorkspaceEmailAddress>(
    await api_client.v1.workspace['email-address'].$post({}),
    { method: 'POST', path: '/v1/workspace/email-address' },
  );
}

export async function update_workspace_email_address(input: {
  username?: string;
  enabled?: boolean;
  attribution_enabled?: boolean;
}): Promise<WorkspaceEmailAddress> {
  return read_api_data<WorkspaceEmailAddress>(
    await api_client.v1.workspace['email-address'].$patch({ json: input }),
    { method: 'PATCH', path: '/v1/workspace/email-address' },
  );
}

export async function list_api_keys(): Promise<ApiKey[]> {
  return read_api_data<ApiKey[]>(
    await api_client.v1['api-keys'].$get(undefined, no_store_request),
    {
      method: 'GET',
      path: '/v1/api-keys',
    },
  );
}

export async function create_api_key(input: {
  key_name: string;
  scopes: ApiKeyScope[];
  key_audience: ApiKeyAudience;
}): Promise<MintedApiKey> {
  return read_api_data<MintedApiKey>(await api_client.v1['api-keys'].$post({ json: input }), {
    method: 'POST',
    path: '/v1/api-keys',
  });
}

export async function revoke_api_key(api_key_id: string): Promise<ApiKey> {
  return read_api_data<ApiKey>(
    await api_client.v1['api-keys'][':api_key_id'].revoke.$post({ param: { api_key_id } }),
    { method: 'POST', path: `/v1/api-keys/${api_key_id}/revoke` },
  );
}

export async function list_models(): Promise<ModelCatalogEntry[]> {
  return read_api_data<ModelCatalogEntry[]>(
    await api_client.v1.models.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/models' },
  );
}

export async function list_sessions(): Promise<Session[]> {
  return read_api_data<Session[]>(
    await api_client.v1.sessions.$get({ query: {} }, no_store_request),
    { method: 'GET', path: '/v1/sessions' },
  );
}

// The chats inside one project. A separate function rather than a parameter on list_sessions,
// because that one is passed bare as a react-query queryFn in five places and react-query
// calls a queryFn with its own context object as the first argument.
export async function list_project_sessions(project_id: string): Promise<Session[]> {
  return read_api_data<Session[]>(
    await api_client.v1.sessions.$get({ query: { project_id } }, no_store_request),
    { method: 'GET', path: '/v1/sessions' },
  );
}

export async function search_session_messages(
  query_text: string,
  signal: AbortSignal,
): Promise<SessionMessageMatch[]> {
  return read_api_data<SessionMessageMatch[]>(
    await api_client.v1.sessions.search.$get(
      { query: { q: query_text } },
      { ...no_store_request, init: { signal } },
    ),
    { method: 'GET', path: '/v1/sessions/search' },
  );
}

export async function delete_chat(session_id: string): Promise<Session> {
  return read_api_data<Session>(
    await session_by_id_client.$delete({ param: { session_id } }, no_store_request),
    { method: 'DELETE', path: `/v1/sessions/${session_id}` },
  );
}

export async function list_agents(): Promise<Agent[]> {
  return read_api_data<Agent[]>(await api_client.v1.agents.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/agents',
  });
}

type UpdateAgentDefaultModel = Parameters<
  typeof agent_by_id_client.$patch
>[0]['json']['default_model'];

export async function update_agent_default_model(
  agent_id: string,
  default_model: UpdateAgentDefaultModel,
): Promise<Agent> {
  return read_api_data(
    await agent_by_id_client.$patch(
      { param: { agent_id }, json: { default_model } },
      { init: { credentials: 'include' } },
    ),
    { method: 'PATCH', path: `/v1/agents/${agent_id}` },
  );
}

export async function create_session(input: {
  session_title?: string;
  project_id?: string;
}): Promise<Session> {
  return read_api_data<Session>(await api_client.v1.sessions.$post({ json: input }), {
    method: 'POST',
    path: '/v1/sessions',
  });
}

export async function list_session_runs(session_id: string): Promise<Run[]> {
  return read_api_data<Run[]>(
    await session_by_id_client.runs.$get({ param: { session_id } }, no_store_request),
    { method: 'GET', path: `/v1/sessions/${session_id}/runs` },
  );
}

export async function list_session_messages(
  session_id: string,
  input: { before_sequence?: number; limit?: number } = {},
): Promise<RunMessagePage> {
  const url = session_by_id_client.messages.$url({ param: { session_id } });
  if (input.before_sequence !== undefined) {
    url.searchParams.set('before_sequence', String(input.before_sequence));
  }
  if (input.limit !== undefined) url.searchParams.set('limit', String(input.limit));

  return read_api_data<RunMessagePage>(await api_fetch(url, { cache: 'no-store' }), {
    method: 'GET',
    path: `/v1/sessions/${session_id}/messages`,
  });
}

export async function send_queued_session_message(
  session_id: string,
  payload: SessionMessagePayload & { client_message_id: string },
): Promise<SentSessionMessage> {
  return read_api_data<SentSessionMessage>(
    await session_queued_messages_client.$post({
      param: { session_id },
      json: payload as Parameters<typeof session_queued_messages_client.$post>[0]['json'],
    }),
    { method: 'POST', path: `/v1/sessions/${session_id}/queued-messages` },
  );
}

export async function get_session_stream_ticket(
  session_id: string,
): Promise<SessionStreamTicket | null> {
  try {
    return await read_api_data<SessionStreamTicket>(
      await session_stream_ticket_client.$post({ param: { session_id } }),
      { method: 'POST', path: `/v1/sessions/${session_id}/stream-ticket` },
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === 'live_stream_unavailable') return null;
    throw error;
  }
}

export async function list_queued_session_messages(
  session_id: string,
): Promise<QueuedSessionMessage[]> {
  return read_api_data<QueuedSessionMessage[]>(
    await session_queued_messages_client.$get({ param: { session_id } }, no_store_request),
    { method: 'GET', path: `/v1/sessions/${session_id}/queued-messages` },
  );
}

export async function remove_queued_session_message(session_id: string, job_id: string) {
  return read_api_data<{ job_id: string; removed: boolean }>(
    await session_queued_messages_client[':job_id'].$delete({ param: { session_id, job_id } }),
    { method: 'DELETE', path: `/v1/sessions/${session_id}/queued-messages/${job_id}` },
  );
}

export async function resume_queued_session_messages(session_id: string) {
  return read_api_data<{ resumed_job_ids: string[] }>(
    await session_queued_messages_client.resume.$post({ param: { session_id } }),
    { method: 'POST', path: `/v1/sessions/${session_id}/queued-messages/resume` },
  );
}

export async function list_session_sandbox_url_previews(
  session_id: string,
): Promise<SandboxUrlPreview[]> {
  return read_api_data<SandboxUrlPreview[]>(
    await session_sandbox_previews_client.$get({ param: { session_id } }, no_store_request),
    { method: 'GET', path: `/v1/sessions/${session_id}/sandbox-previews` },
  );
}

export async function start_session_browser(
  session_id: string,
  signal?: AbortSignal,
): Promise<SandboxUrlPreview> {
  return read_api_data<SandboxUrlPreview>(
    await session_by_id_client.browser.start.$post(
      { param: { session_id } },
      { init: { signal: signal ?? null } },
    ),
    { method: 'POST', path: `/v1/sessions/${session_id}/browser/start` },
  );
}

export async function list_run_tool_calls(run_id: string): Promise<ToolCall[]> {
  return read_api_data<ToolCall[]>(
    await run_tool_calls_client.$get({ param: { run_id } }, no_store_request),
    { method: 'GET', path: `/v1/runs/${run_id}/tool-calls` },
  );
}

export async function cancel_run(run_id: string): Promise<Run> {
  return read_api_data<Run>(await run_by_id_client.cancel.$post({ param: { run_id } }), {
    method: 'POST',
    path: `/v1/runs/${run_id}/cancel`,
  });
}

export async function list_session_tool_calls(session_id: string): Promise<ToolCall[]> {
  return read_api_data<ToolCall[]>(
    await session_tool_calls_client.$get({ param: { session_id } }, no_store_request),
    { method: 'GET', path: `/v1/sessions/${session_id}/tool-calls` },
  );
}

export async function inspect_run(run_id: string): Promise<RunInspection> {
  return read_api_data<RunInspection>(
    await run_inspection_client.$get({ param: { run_id } }, no_store_request),
    { method: 'GET', path: `/v1/runs/${run_id}/inspect` },
  );
}

export const chat_stream_events_page_limit = 500;

export async function list_run_chat_stream_events(
  run_id: string,
  input: { after_sequence?: number } = {},
): Promise<ChatStreamEvent[]> {
  const url = run_chat_stream_events_client.$url({ param: { run_id } });
  if (input.after_sequence !== undefined) {
    url.searchParams.set('after_sequence', String(input.after_sequence));
  }
  url.searchParams.set('limit', String(chat_stream_events_page_limit));

  return read_api_data<ChatStreamEvent[]>(await api_fetch(url, { cache: 'no-store' }), {
    method: 'GET',
    path: `/v1/runs/${run_id}/chat-stream-events`,
  });
}

export async function open_artifact_content(file_id: string): Promise<ArtifactContent> {
  return read_api_data<ArtifactContent>(
    await artifact_content_client.$get({ param: { file_id } }, no_store_request),
    { method: 'GET', path: `/v1/files/${file_id}/content` },
  );
}

export async function list_workspace_files(folder_path: string): Promise<WorkspaceFilesFolder> {
  return read_api_data<WorkspaceFilesFolder>(
    await workspace_files_client.$get({ query: { folder_path } }, no_store_request),
    { method: 'GET', path: '/v1/workspace/files' },
  );
}

export async function open_workspace_file(file_path: string): Promise<WorkspaceFileContent> {
  return read_api_data<WorkspaceFileContent>(
    await workspace_file_content_client.$get({ query: { file_path } }, no_store_request),
    { method: 'GET', path: '/v1/workspace/files/content' },
  );
}

export async function open_workspace_file_if_present(file_path: string) {
  const slash = file_path.lastIndexOf('/');
  const folder = await list_workspace_files(file_path.slice(0, Math.max(slash, 0)));
  const file_name = file_path.slice(slash + 1);
  const is_listed = folder.files.some((file) => file.file_name === file_name);
  return is_listed ? open_workspace_file(file_path) : null;
}

export async function save_workspace_file(input: {
  file_path: string;
  content_text: string;
  expected_version: string;
}): Promise<{ file_path: string; saved: true; content_version: string }> {
  return read_api_data<{ file_path: string; saved: true; content_version: string }>(
    await workspace_file_content_client.$put({ json: input }, no_store_request),
    { method: 'PUT', path: '/v1/workspace/files/content' },
  );
}

export async function save_workspace_file_bytes(input: {
  file_path: string;
  bytes: Uint8Array;
  expected_version: string;
}): Promise<{ file_path: string; saved: true; content_version: string }> {
  if (input.bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error('Word files can contain up to 25 MiB when saving. Your changes remain here.');
  }
  if (input.bytes.byteLength > 4 * 1024 * 1024) {
    const { upload_attachment_to_storage } = await import('@/lib/api/upload_attachment');
    const uploaded = await upload_attachment_to_storage(
      new File([new Uint8Array(input.bytes)], input.file_path.split('/').pop() ?? 'document.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      {},
    );
    return read_api_data(
      await workspace_files_client.upload.$put({
        json: {
          file_path: input.file_path,
          uploaded_file_id: uploaded.file_id,
          expected_version: input.expected_version,
        },
      }),
      { method: 'PUT', path: '/v1/workspace/files/upload' },
    );
  }
  const url = api_url('/v1/workspace/files/bytes');
  url.searchParams.set('file_path', input.file_path);
  return read_api_data(
    await api_fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'If-Match': input.expected_version,
      },
      body: new Blob([new Uint8Array(input.bytes)]),
    }),
    { method: 'PUT', path: '/v1/workspace/files/bytes' },
  );
}

export async function open_workspace_file_bytes(file_path: string, signal?: AbortSignal) {
  const response = await api_fetch(workspace_file_download_url(file_path), {
    cache: 'no-store',
    signal: signal ?? null,
  });
  if (!response.ok)
    await read_api_data(response, { method: 'GET', path: '/v1/workspace/files/download' });
  const max_bytes = 25 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max_bytes) {
    await response.body?.cancel();
    throw new Error('This file is too large to preview. Download it to open it.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The file response has no contents.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byte_count = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byte_count += part.value.byteLength;
      if (byte_count > max_bytes) {
        await reader.cancel();
        throw new Error('This file is too large to preview. Download it to open it.');
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = await new Blob(chunks).arrayBuffer();
  return { bytes, content_version: await read_file_content_version(response.headers, bytes) };
}

/** Same-origin URL for a workspace file's raw bytes — used by <img> and download links. */
export function workspace_file_download_url(file_path: string): string {
  const url = workspace_files_client.download.$url();
  url.searchParams.set('file_path', file_path);
  return url.toString();
}

export async function list_catalog_apps(): Promise<CatalogApp[]> {
  return read_api_data<CatalogApp[]>(await api_client.v1.apps.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/apps',
  });
}

export async function list_catalog_apps_by_keys(keys: string[]): Promise<CatalogApp[]> {
  return read_api_data<CatalogApp[]>(
    await api_client.v1.apps['by-keys'].$get(
      {
        query: { keys: keys.join(',') },
      },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/apps/by-keys' },
  );
}

export async function search_catalog_apps(input: {
  query?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}): Promise<CatalogAppSearchResult> {
  return read_api_data<CatalogAppSearchResult>(
    await api_client.v1.apps.search.$get(
      {
        query: {
          ...(input.query ? { q: input.query } : {}),
          ...(input.limit !== undefined ? { limit: String(input.limit) } : {}),
          ...(input.offset !== undefined ? { offset: String(input.offset) } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
        },
      },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/apps/search' },
  );
}

export async function list_catalog_nodes(keys?: string[]): Promise<CatalogNode[]> {
  const query = keys && keys.length > 0 ? { keys: keys.join(',') } : {};
  return read_api_data<CatalogNode[]>(await api_client.v1.nodes.$get({ query }, no_store_request), {
    method: 'GET',
    path: '/v1/nodes',
  });
}

export async function list_connections(): Promise<Connection[]> {
  return read_api_data<Connection[]>(
    await api_client.v1.connections.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/connections' },
  );
}

export async function get_connection(connection_id: string): Promise<Connection> {
  return read_api_data<Connection>(
    await connection_by_id_client.$get({ param: { connection_id } }, no_store_request),
    { method: 'GET', path: `/v1/connections/${connection_id}` },
  );
}

export async function list_connection_tools(connection_id: string): Promise<ConnectionTool[]> {
  return read_api_data<ConnectionTool[]>(
    await connection_by_id_client.tools.$get({ param: { connection_id } }, no_store_request),
    { method: 'GET', path: `/v1/connections/${connection_id}/tools` },
  );
}

export async function create_connection(input: {
  app_id: string;
  provider_key?: string;
  provider_config_key?: string;
  connection_profile_key?: string;
  connection_name?: string;
  access_type?: 'shared' | 'restricted';
  redirect_uri?: string;
}): Promise<ConnectionSetupResult> {
  return read_api_data(await api_client.v1.connections.$post({ json: input }), {
    method: 'POST',
    path: '/v1/connections',
  });
}

export async function revoke_connection(connection_id: string): Promise<Connection> {
  return read_api_data(await connection_by_id_client.revoke.$post({ param: { connection_id } }), {
    method: 'POST',
    path: `/v1/connections/${connection_id}/revoke`,
  });
}

export async function patch_connection(
  connection_id: string,
  input: { connection_name?: string; access_type?: 'shared' | 'restricted' },
): Promise<Connection> {
  return read_api_data(
    await api_client.v1.connections[':connection_id'].$patch({
      param: { connection_id },
      json: input,
    }),
    { method: 'PATCH', path: `/v1/connections/${connection_id}` },
  );
}

export type WorkspaceMember = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  member_role: string;
};

export async function set_workspace_member_role(
  user_id: string,
  role: 'member' | 'admin',
): Promise<{ user_id: string; member_role: string }> {
  return read_api_data(
    await api_client.v1.workspace.members[':user_id'].$patch({
      param: { user_id },
      json: { role },
    }),
    { method: 'PATCH', path: `/v1/workspace/members/${user_id}` },
  );
}

export async function list_workspace_members(): Promise<WorkspaceMember[]> {
  const data = await read_api_data<{ members: WorkspaceMember[] }>(
    await api_client.v1.workspace.members.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/workspace/members' },
  );
  return data.members;
}

export type WorkspaceInvitation = {
  invitation_id: string;
  email: string;
  role_slug?: string;
  created_time: string;
};

export type WorkspaceInvitationRole = 'member' | 'admin';

export async function list_workspace_invitations(): Promise<WorkspaceInvitation[]> {
  const data = await read_api_data<{ invitations: WorkspaceInvitation[] }>(
    await api_client.v1.workspace.invitations.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/workspace/invitations' },
  );
  return data.invitations;
}

export async function send_workspace_invitation(input: {
  email: string;
  role: WorkspaceInvitationRole;
}): Promise<WorkspaceInvitation> {
  return read_api_data<WorkspaceInvitation>(
    await api_client.v1.workspace.invitations.$post({ json: input }),
    { method: 'POST', path: '/v1/workspace/invitations' },
  );
}

export async function revoke_workspace_invitation(invitation_id: string): Promise<void> {
  await read_api_data(
    await api_client.v1.workspace.invitations[':invitation_id'].$delete({
      param: { invitation_id },
    }),
    { method: 'DELETE', path: `/v1/workspace/invitations/${invitation_id}` },
  );
}

export async function complete_connection_setup(connection_id: string): Promise<Connection> {
  return read_api_data(await connection_by_id_client.complete.$post({ param: { connection_id } }), {
    method: 'POST',
    path: `/v1/connections/${connection_id}/complete`,
  });
}

export async function complete_public_connection_setup(input: {
  connection_id: string;
  setup_token: string;
  api_origin: string;
}): Promise<unknown> {
  const url = new URL('/v1/connections/setup/complete', input.api_origin);
  url.searchParams.set('connection_id', input.connection_id);
  url.searchParams.set('setup_token', input.setup_token);

  return read_api_data(
    await fetch(url.toString(), {
      method: 'POST',
      credentials: 'omit',
    }),
    { method: 'POST', path: '/v1/connections/setup/complete' },
  );
}

export async function reconnect_connection(
  connection_id: string,
  input: { redirect_uri?: string } = {},
): Promise<ConnectionSetupResult> {
  const url = connection_by_id_client.reconnect.$url({ param: { connection_id } });
  return read_api_data(
    await api_fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    { method: 'POST', path: `/v1/connections/${connection_id}/reconnect` },
  );
}

export async function list_projects(query?: string): Promise<Project[]> {
  return read_api_data<Project[]>(
    await api_client.v1.projects.$get(
      { query: { project_status: 'active', limit: '200', ...(query ? { query } : {}) } },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/projects' },
  );
}

export async function create_project(project_name: string): Promise<Project> {
  return read_api_data(await api_client.v1.projects.$post({ json: { project_name } }), {
    method: 'POST',
    path: '/v1/projects',
  });
}

export async function get_project(project_id: string): Promise<Project> {
  return read_api_data<Project>(
    await api_client.v1.projects[':project_id'].$get({ param: { project_id } }, no_store_request),
    { method: 'GET', path: `/v1/projects/${project_id}` },
  );
}

export async function update_project(
  project_id: string,
  input: {
    project_name?: string;
    project_status?: 'active' | 'archived';
    project_description?: string | null;
    project_instructions?: string | null;
  },
): Promise<Project> {
  return read_api_data(
    await api_client.v1.projects[':project_id'].$patch({ param: { project_id }, json: input }),
    { method: 'PATCH', path: `/v1/projects/${project_id}` },
  );
}

export async function list_project_members(project_id: string): Promise<ProjectMembership> {
  return read_api_data<ProjectMembership>(
    await api_client.v1.projects[':project_id'].members.$get(
      { param: { project_id } },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/projects/${project_id}/members` },
  );
}

export async function add_project_member(
  project_id: string,
  input: { grantee_type: 'user' | 'agent'; grantee_id: string; grant_level: 'use' | 'manage' },
): Promise<ProjectMember> {
  return read_api_data(
    await api_client.v1.projects[':project_id'].members.$put({
      param: { project_id },
      json: input,
    }),
    { method: 'PUT', path: `/v1/projects/${project_id}/members` },
  );
}

export async function remove_project_member(
  project_id: string,
  grantee_type: 'user' | 'agent',
  grantee_id: string,
): Promise<void> {
  const response = await api_client.v1.projects[':project_id'].members[':grantee_type'][
    ':grantee_id'
  ].$delete({ param: { project_id, grantee_type, grantee_id } });
  if (!response.ok) {
    await read_api_data(response, {
      method: 'DELETE',
      path: `/v1/projects/${project_id}/members/${grantee_type}/${grantee_id}`,
    });
  }
}

export async function list_project_channels(project_id: string): Promise<ProjectChannel[]> {
  return read_api_data<ProjectChannel[]>(
    await api_client.v1.projects[':project_id'].channels.$get(
      { param: { project_id } },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/projects/${project_id}/channels` },
  );
}

export async function remove_project_channel(input: {
  project_id: string;
  channel_route_id: string;
}): Promise<void> {
  const response = await api_client.v1.projects[':project_id'].channels[
    ':channel_route_id'
  ].$delete({ param: input });
  if (!response.ok) {
    await read_api_data(response, {
      method: 'DELETE',
      path: `/v1/projects/${input.project_id}/channels/${input.channel_route_id}`,
    });
  }
}

export async function list_triggers(): Promise<Trigger[]> {
  return read_api_data<Trigger[]>(await api_client.v1.triggers.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/triggers',
  });
}

export type TriggerRunHistoryItem = {
  run_id: string;
  session_id: string;
  run_number: number;
  run_status: string;
  error_message: string | null;
  started_time: string | null;
  finished_time: string | null;
  created_time: string;
  is_unread: boolean;
};

export type TriggerRunHistoryPage = {
  items: TriggerRunHistoryItem[];
  total_count: number;
  page: number;
  page_size: number;
};

export async function list_trigger_runs(
  trigger_id: string,
  input: { page?: number; page_size?: number } = {},
): Promise<TriggerRunHistoryPage> {
  const query = {
    ...(input.page !== undefined ? { page: String(input.page) } : {}),
    ...(input.page_size !== undefined ? { page_size: String(input.page_size) } : {}),
  };
  return read_api_data<TriggerRunHistoryPage>(
    await api_client.v1.triggers[':trigger_id'].runs.$get(
      { param: { trigger_id }, query },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/triggers/${trigger_id}/runs` },
  );
}

export async function mark_trigger_runs_read(
  trigger_id: string,
): Promise<{ marked_session_count: number }> {
  return read_api_data<{ marked_session_count: number }>(
    await api_client.v1.triggers[':trigger_id'].runs.read.$post({ param: { trigger_id } }),
    { method: 'POST', path: `/v1/triggers/${trigger_id}/runs/read` },
  );
}

export async function create_trigger(input: {
  trigger_name: string;
  trigger_type: 'schedule' | 'manual';
  schedule_expression?: string | null;
  agent_id?: string;
  trigger_config?: Record<string, unknown>;
}): Promise<Trigger> {
  return read_api_data(await api_client.v1.triggers.$post({ json: input }), {
    method: 'POST',
    path: '/v1/triggers',
  });
}

export type TriggerRunResult = {
  fired: boolean;
  trigger_id: string;
  event_id: string;
  queued_job_count: number;
  event_job_ids: string[];
};

export async function run_trigger(
  trigger_id: string,
  occurrence_key: string,
): Promise<TriggerRunResult> {
  return read_api_data(
    await api_client.v1.triggers[':trigger_id'].run.$post({
      param: { trigger_id },
      json: { occurrence_key },
    }),
    { method: 'POST', path: `/v1/triggers/${trigger_id}/run` },
  );
}

export async function update_trigger(
  trigger_id: string,
  input: {
    trigger_name?: string;
    trigger_type?: 'schedule' | 'manual';
    schedule_expression?: string | null;
    agent_id?: string;
    trigger_config?: Record<string, unknown>;
  },
): Promise<Trigger> {
  const url = api_client.v1.triggers[':trigger_id'].$url({ param: { trigger_id } });
  return read_api_data(
    await api_fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    { method: 'PATCH', path: `/v1/triggers/${trigger_id}` },
  );
}

export async function set_trigger_status(
  trigger_id: string,
  trigger_status: TriggerStatus,
): Promise<Trigger> {
  const url = api_client.v1.triggers[':trigger_id'].$url({ param: { trigger_id } });
  return read_api_data(
    await api_fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_status }),
    }),
    { method: 'PATCH', path: `/v1/triggers/${trigger_id}` },
  );
}

export async function delete_trigger(trigger_id: string): Promise<{ trigger_id: string }> {
  return read_api_data(
    await api_client.v1.triggers[':trigger_id'].$delete({ param: { trigger_id } }),
    { method: 'DELETE', path: `/v1/triggers/${trigger_id}` },
  );
}

export async function list_agent_enabled_nodes(agent_id: string): Promise<AgentEnabledNode[]> {
  return read_api_data(
    await agent_by_id_client['enabled-nodes'].$get({ param: { agent_id } }, no_store_request),
    { method: 'GET', path: `/v1/agents/${agent_id}/enabled-nodes` },
  );
}

export async function update_agent_enabled_nodes(
  agent_id: string,
  enabled_nodes: AgentEnabledNode[],
): Promise<AgentEnabledNode[]> {
  const url = agent_enabled_nodes_client.$url({ param: { agent_id } });
  return read_api_data(
    await api_fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled_nodes }),
    }),
    { method: 'PUT', path: `/v1/agents/${agent_id}/enabled-nodes` },
  );
}

export async function get_onboarding(): Promise<OnboardingSnapshot> {
  return read_api_data<OnboardingSnapshot>(
    await api_client.v1.onboarding.$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/onboarding' },
  );
}

export async function save_onboarding_profile(
  input: OnboardingProfileInput,
): Promise<SaveOnboardingProfileResult> {
  return read_api_data<SaveOnboardingProfileResult>(
    await api_client.v1.onboarding.profile.$post({ json: input }),
    { method: 'POST', path: '/v1/onboarding/profile' },
  );
}

export async function set_onboarding_step(step: string): Promise<OnboardingRecord> {
  return read_api_data<OnboardingRecord>(
    await api_client.v1.onboarding.step.$post({ json: { step } }),
    { method: 'POST', path: '/v1/onboarding/step' },
  );
}

export async function complete_onboarding(job_name?: string): Promise<OnboardingCompletion> {
  return read_api_data<OnboardingCompletion>(
    await api_client.v1.onboarding.complete.$post({ json: { picked_job_name: job_name } }),
    { method: 'POST', path: '/v1/onboarding/complete' },
  );
}

export async function skip_onboarding_for_dev(): Promise<DevOnboardingSkip> {
  return read_api_data<DevOnboardingSkip>(await api_client.v1.onboarding['dev-skip'].$post(), {
    method: 'POST',
    path: '/v1/onboarding/dev-skip',
  });
}

export async function start_company_scan(input: {
  website_url?: string;
  company_description?: string;
}): Promise<CompanyScanResult> {
  return read_api_data<CompanyScanResult>(
    await api_client.v1.onboarding['company-scan'].$post({ json: input }),
    { method: 'POST', path: '/v1/onboarding/company-scan' },
  );
}

export async function send_onboarding_welcome(): Promise<OnboardingWelcomeResult> {
  return read_api_data<OnboardingWelcomeResult>(await api_client.v1.onboarding.welcome.$post(), {
    method: 'POST',
    path: '/v1/onboarding/welcome',
  });
}

export async function start_slack_connect(
  input: { redirect_uri?: string } = {},
): Promise<SlackConnectResult> {
  return read_api_data<SlackConnectResult>(
    await api_client.v1.slack.connect.$post({ json: input }),
    { method: 'POST', path: '/v1/slack/connect' },
  );
}

export async function list_slack_channels(
  input: { cursor?: string } = {},
): Promise<SlackChannelPage> {
  return read_api_data<SlackChannelPage>(
    await api_client.v1.slack.channels.$get(
      { query: input.cursor ? { cursor: input.cursor } : {} },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/slack/channels' },
  );
}

export async function join_slack_channels(input: {
  all_public?: boolean;
  channel_ids?: string[];
}): Promise<JoinSlackChannelsResult> {
  return read_api_data<JoinSlackChannelsResult>(
    await api_client.v1.slack.channels.join.$post({ json: input }),
    { method: 'POST', path: '/v1/slack/channels/join' },
  );
}

export async function list_slack_channel_settings(input: {
  visibility: SlackChannelSettingsVisibility;
  cursor?: string;
}): Promise<SlackChannelSettingsPage> {
  return read_api_data<SlackChannelSettingsPage>(
    await api_client.v1.slack['channel-settings'].$get(
      {
        query: {
          visibility: input.visibility,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        },
      },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/slack/channel-settings' },
  );
}

// project_id absent keeps the channel's project; null takes it out of any project.
export async function set_slack_channel_access(input: {
  channel_id: string;
  enabled: boolean;
  project_id?: string | null;
  channel_name?: string;
}): Promise<SlackChannelAccessResult> {
  const { channel_id, ...json } = input;
  return read_api_data<SlackChannelAccessResult>(
    await api_client.v1.slack['channel-settings'][':channel_id'].$put({
      param: { channel_id },
      json,
    }),
    { method: 'PUT', path: `/v1/slack/channel-settings/${input.channel_id}` },
  );
}

export type CredentialTypeChoice = {
  credential_type_key: string;
  label: string;
  standard: string;
  goes: string;
  fields: {
    field_name: string;
    label: string;
    is_secret: boolean;
    prefilled_value: string | null;
  }[];
};

export async function list_credential_types(): Promise<CredentialTypeChoice[]> {
  const result = await read_api_data<{ credential_types: CredentialTypeChoice[] }>(
    await api_client.v1['connection-credential-types'].$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/connection-credential-types' },
  );
  return result.credential_types;
}

type WorkspaceCredential = {
  connection_id: string;
  connection_name: string | null;
  app_display_name: string;
  connection_status: string;
  health_status: string;
  allowed_hosts: string[];
};

export async function list_workspace_credentials(): Promise<WorkspaceCredential[]> {
  const result = await read_api_data<{ credentials: WorkspaceCredential[] }>(
    await api_client.v1['connection-credentials'].$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/connection-credentials' },
  );
  return result.credentials;
}

type CreateWorkspaceCredentialInput = Parameters<
  (typeof api_client.v1)['connection-credentials']['$post']
>[0]['json'];

export async function create_workspace_credential(
  input: CreateWorkspaceCredentialInput,
): Promise<{ connection_id: string; app_id: string }> {
  return read_api_data<{ connection_id: string; app_id: string }>(
    await api_client.v1['connection-credentials'].$post({ json: input }),
    { method: 'POST', path: '/v1/connection-credentials' },
  );
}

export type CredentialExchangeReport =
  | { exchanged: true; delivers_headers: string[]; expires_time: string | null }
  | {
      exchanged: false;
      outcome: string;
      message: string;
      retry_allowed_after_time?: string;
    };

export async function exchange_workspace_credential(
  connection_id: string,
): Promise<CredentialExchangeReport> {
  return read_api_data<CredentialExchangeReport>(
    await api_client.v1['connection-credentials'][':connection_id'].exchange.$post({
      param: { connection_id },
    }),
    { method: 'POST', path: `/v1/connection-credentials/${connection_id}/exchange` },
  );
}

export type AppSignInForm = {
  app_display_name: string;
  website_host: string;
  logo_url: string | null;
  sign_in_name_label: string;
  could_not_determine: string[];
};

export type CompleteAppSignInResult =
  | { connected: true; delivers_headers: string[] }
  | { connected: false; message: string; retry_allowed_after_time?: string };

export async function get_app_sign_in_form(connection_id: string): Promise<AppSignInForm> {
  return read_api_data<AppSignInForm>(
    await api_client.v1['app-sign-in'][':connection_id'].$get(
      { param: { connection_id } },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/app-sign-in/${connection_id}` },
  );
}

export async function complete_app_sign_in(input: {
  connection_id: string;
  sign_in_name: string;
  password: string;
}): Promise<CompleteAppSignInResult> {
  return read_api_data<CompleteAppSignInResult>(
    await api_client.v1['app-sign-in'][':connection_id'].$post({
      param: { connection_id: input.connection_id },
      json: { sign_in_name: input.sign_in_name, password: input.password },
    }),
    { method: 'POST', path: `/v1/app-sign-in/${input.connection_id}` },
  );
}

export async function disable_workspace_credential(
  connection_id: string,
): Promise<{ disabled: boolean }> {
  return read_api_data<{ disabled: boolean }>(
    await api_client.v1['connection-credentials'][':connection_id'].$delete({
      param: { connection_id },
    }),
    { method: 'DELETE', path: `/v1/connection-credentials/${connection_id}` },
  );
}

export async function mark_session_read(input: {
  session_id: string;
  last_read_sequence: number;
}): Promise<unknown> {
  return read_api_data<unknown>(
    await api_client.v1.sessions[':session_id'].read.$post({
      param: { session_id: input.session_id },
      json: { last_read_sequence: input.last_read_sequence },
    }),
    { method: 'POST', path: `/v1/sessions/${input.session_id}/read` },
  );
}

export async function cancel_connection_setup(
  connection_id: string,
): Promise<{ cancelled: boolean }> {
  return read_api_data<{ cancelled: boolean }>(
    await api_client.v1.connections[':connection_id']['cancel-setup'].$post({
      param: { connection_id },
    }),
    { method: 'POST', path: `/v1/connections/${connection_id}/cancel-setup` },
  );
}

export async function postpone_connection_setup(
  connection_id: string,
): Promise<{ postponed: boolean }> {
  return read_api_data<{ postponed: boolean }>(
    await api_client.v1.connections[':connection_id']['postpone-setup'].$post({
      param: { connection_id },
    }),
    { method: 'POST', path: `/v1/connections/${connection_id}/postpone-setup` },
  );
}

export async function inspect_mcp_server(input: {
  server_url: string;
}): Promise<InspectedMcpServer> {
  return read_api_data<InspectedMcpServer>(
    await api_client.v1['mcp-servers'].inspect.$post({ json: input }),
    { method: 'POST', path: '/v1/mcp-servers/inspect' },
  );
}

export async function add_mcp_server(input: {
  server_url: string;
  display_name?: string;
  access_token?: string;
  oauth_client?: { client_id: string; client_secret?: string };
  authentication?: McpAuthenticationMode;
  request_headers?: Array<{ name: string; value: string }>;
}): Promise<AddedMcpServer> {
  return read_api_data<AddedMcpServer>(await api_client.v1['mcp-servers'].$post({ json: input }), {
    method: 'POST',
    path: '/v1/mcp-servers',
  });
}

export type SharingGrantee =
  | { project: string; can: 'use' | 'manage' }
  | { person: string; can: 'use' | 'manage' }
  | { coworker: string; can: 'use' | 'manage' };

export type ResourceSharing = {
  resource_type: string;
  shared_with_everyone_in_the_workspace: boolean;
  shared_with: SharingGrantee[];
};

export async function get_resource_sharing(
  resource_type: string,
  resource_id: string,
): Promise<ResourceSharing> {
  return read_api_data<ResourceSharing>(
    await api_client.v1.access[':resource_type'][':resource_id'].$get(
      { param: { resource_type, resource_id } },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/access/${resource_type}/${resource_id}` },
  );
}

export async function set_resource_sharing(
  resource_type: string,
  resource_id: string,
  body: {
    shared_with_everyone_in_the_workspace: boolean;
    shared_with: SharingGrantee[];
    replaces?: SharingGrantee[];
  },
): Promise<ResourceSharing> {
  return read_api_data<ResourceSharing>(
    await api_client.v1.access[':resource_type'][':resource_id'].$put({
      param: { resource_type, resource_id },
      json: body,
    }),
    { method: 'PUT', path: `/v1/access/${resource_type}/${resource_id}` },
  );
}

export async function add_resource_grantee(
  resource_type: string,
  resource_id: string,
  entry: SharingGrantee,
): Promise<ResourceSharing> {
  return read_api_data<ResourceSharing>(
    await api_client.v1.access[':resource_type'][':resource_id'].grantees.$post({
      param: { resource_type, resource_id },
      json: entry,
    }),
    { method: 'POST', path: `/v1/access/${resource_type}/${resource_id}/grantees` },
  );
}

export async function remove_resource_grantee(
  resource_type: string,
  resource_id: string,
  grantee_type: 'project' | 'user' | 'agent',
  grantee_id: string,
): Promise<ResourceSharing> {
  const path = `/v1/access/${resource_type}/${resource_id}/grantees/${grantee_type}/${grantee_id}`;
  return read_api_data<ResourceSharing>(
    await api_client.v1.access[':resource_type'][':resource_id'].grantees[':grantee_type'][
      ':grantee_id'
    ].$delete({ param: { resource_type, resource_id, grantee_type, grantee_id } }),
    { method: 'DELETE', path },
  );
}
