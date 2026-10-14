import { update_agent_body_schema } from '@api/routes/public_agents';
import { send_events_body_schema } from '@api/routes/public_session_events';
import { create_session_body_schema, move_session_body_schema } from '@api/routes/public_sessions';
import { rename_workspace_body_schema } from '@api/routes/public_workspace';
import {
  answer_request_schemas,
  answer_route_descriptors,
  automation_request_schemas,
  automation_route_descriptors,
  memory_request_schemas,
  memory_route_descriptors,
  usage_route_descriptors,
} from '@api/services/openapi/cloud_route_descriptors';
import type { z } from 'zod';

export const request_component_schemas: Record<string, z.ZodType> = {
  ...answer_request_schemas,
  UpdateAgentRequest: update_agent_body_schema,
  CreateSessionRequest: create_session_body_schema,
  MoveSessionRequest: move_session_body_schema,
  SendSessionEventsRequest: send_events_body_schema,
  ...automation_request_schemas,
  RenameWorkspaceRequest: rename_workspace_body_schema,
  ...memory_request_schemas,
};

export type RouteDescriptor = {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  auth: 'bearer' | 'public';
  request?: keyof typeof request_component_schemas;
  path_params?: string[];
  success_status: string;
};

const session = ['session_id'];

export const route_descriptors: RouteDescriptor[] = [
  {
    method: 'get',
    path: '/v1/me',
    summary: 'Identify the calling key and its capabilities.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/workspace',
    summary: "Read the key's workspace.",
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'patch',
    path: '/v1/workspace',
    summary: 'Rename the workspace.',
    auth: 'bearer',
    request: 'RenameWorkspaceRequest',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/agents',
    summary: 'List the workspace agents.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/agents/{agent_slug}',
    summary: 'Read one agent by slug.',
    auth: 'bearer',
    path_params: ['agent_slug'],
    success_status: '200',
  },
  {
    method: 'patch',
    path: '/v1/agents/{agent_slug}',
    summary: 'Rename an agent or rewrite its instructions.',
    auth: 'bearer',
    request: 'UpdateAgentRequest',
    path_params: ['agent_slug'],
    success_status: '200',
  },
  {
    method: 'post',
    path: '/v1/sessions',
    summary: 'Open a session with an agent.',
    auth: 'bearer',
    request: 'CreateSessionRequest',
    success_status: '201',
  },
  {
    method: 'get',
    path: '/v1/sessions',
    summary: 'List the sessions this key opened.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/sessions/{session_id}',
    summary: 'Read one session.',
    auth: 'bearer',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'patch',
    path: '/v1/sessions/{session_id}',
    summary: 'File a session into a project, or out of one.',
    auth: 'bearer',
    request: 'MoveSessionRequest',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'post',
    path: '/v1/sessions/{session_id}/events',
    summary: 'Send messages, interrupts, or tool decisions into a session.',
    auth: 'bearer',
    request: 'SendSessionEventsRequest',
    path_params: session,
    success_status: '202',
  },
  {
    method: 'get',
    path: '/v1/sessions/{session_id}/events',
    summary: "Read a session's event history.",
    auth: 'bearer',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/sessions/{session_id}/events/stream',
    summary: "Stream a session's events as server-sent events.",
    auth: 'bearer',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'post',
    path: '/v1/sessions/{session_id}/archive',
    summary: 'Archive a session. Archive is the terminal verb.',
    auth: 'bearer',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/sessions/{session_id}/files',
    summary: 'List the files a session produced.',
    auth: 'bearer',
    path_params: session,
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/files/{file_id}/content',
    summary: 'Download the bytes of one session file.',
    auth: 'bearer',
    path_params: ['file_id'],
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/projects',
    summary: 'List the projects shared with the whole workspace.',
    auth: 'bearer',
    success_status: '200',
  },
  ...automation_route_descriptors,
  {
    method: 'get',
    path: '/v1/skills',
    summary: 'List the skills an agent can load.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/skills/{skill_id}',
    summary: 'Read one skill.',
    auth: 'bearer',
    path_params: ['skill_id'],
    success_status: '200',
  },
  ...usage_route_descriptors,
  {
    method: 'get',
    path: '/v1/integrations',
    summary: 'List the workspace connected integrations and their tool counts.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/integrations/{integration_key}/tools',
    summary: 'List one integration tools, parameters, and approval need.',
    auth: 'bearer',
    path_params: ['integration_key'],
    success_status: '200',
  },
  ...memory_route_descriptors,
  ...answer_route_descriptors,
  {
    method: 'post',
    path: '/v1/mcp',
    summary: 'The MCP endpoint: JSON-RPC over a single POST, same key, same tools.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/openapi.json',
    summary: 'This document.',
    auth: 'public',
    success_status: '200',
  },
];
