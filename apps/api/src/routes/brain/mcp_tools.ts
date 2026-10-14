import { api_key_can_use_scope } from '@api/lib/api_key_auth';
import { type BrainTool, define_brain_tool } from '@api/routes/brain/brain_tool';
import { answer_mcp_tools } from '@api/routes/brain/mcp_answer_tools';
import { automation_mcp_tools } from '@api/routes/brain/mcp_automation_tools';
import { memory_mcp_tools } from '@api/routes/brain/mcp_memory_tools';
import { format_agent_for_mcp } from '@api/routes/brain/mcp_outputs';
import { list_agents_description } from '@api/routes/brain/mcp_server_words';
import { session_mcp_tools } from '@api/routes/brain/mcp_session_tools';
import { reads_the_workspace } from '@api/routes/brain/mcp_tool_annotations';
import { usage_mcp_tools } from '@api/routes/brain/mcp_usage_tools';
import { workspace_mcp_tools } from '@api/routes/brain/mcp_workspace_tools';
import { public_agent } from '@api/routes/public_agents';
import { refuse_memory_write } from '@api/services/brain/memory_write_retired';
import { read_api_workspace_name } from '@api/services/workspace_api/workspace_name_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { list_agents } from '@coworker/core/db/queries/sessions';
import { z } from 'zod';

export const brain_mcp_tools: Record<string, BrainTool> = {
  whoami: define_brain_tool({
    title: 'Who am I',
    annotations: reads_the_workspace,
    description:
      'Report which Alfera workspace this connection reaches and which tools it may call. Use it only when the person asks which workspace they are connected to.',
    required_scope: null,
    input_schema: z.object({}).strict(),
    run: describe_connection_for_mcp,
  }),

  ...answer_mcp_tools,

  list_agents: define_brain_tool({
    title: 'List agents',
    annotations: reads_the_workspace,
    description: list_agents_description,
    required_scope: 'agents.read',
    input_schema: z.object({}).strict(),
    run: async (db, api_key) =>
      (await list_agents(db, api_key.workspace_id)).map(public_agent).map(format_agent_for_mcp),
  }),

  ...session_mcp_tools,
  ...usage_mcp_tools,
  ...workspace_mcp_tools,
  ...automation_mcp_tools,
  ...memory_mcp_tools,
};

export function list_tool_names_the_key_may_call(api_key: ApiKey): string[] {
  return Object.entries(brain_mcp_tools)
    .filter(
      ([, tool]) => !tool.required_scope || api_key_can_use_scope(api_key, tool.required_scope),
    )
    .map(([tool_name]) => tool_name);
}

async function describe_connection_for_mcp(db: Database, api_key: ApiKey) {
  return {
    workspace_name: await read_api_workspace_name(db, api_key),
    key_name: api_key.key_name,
    tool_names: list_tool_names_the_key_may_call(api_key),
  };
}

export const renamed_mcp_tool_names: Record<string, string> = {
  ask_worker: 'ask_agent',
  wait_for_session_idle: 'wait_for_session',
  read_memory_document: 'get_memory_document',
};

export const retired_mcp_tools: Record<string, BrainTool> = {
  teach_memory: define_brain_tool({
    title: 'Teach memory (retired)',
    annotations: reads_the_workspace,
    description:
      'Retired. The workspace brain is fed by its connected sources, not by API writes. Calling this returns the sentence that says so.',
    required_scope: 'memory.write',
    input_schema: z.object({}).loose(),
    run: async () => refuse_memory_write(),
  }),
};
