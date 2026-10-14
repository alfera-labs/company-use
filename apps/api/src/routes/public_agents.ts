import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_json_body } from '@api/lib/validate';
import { key_authed_tool_route } from '@api/services/policies/alfera_api_tool_gate';
import type { agents } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { find_agent_by_slug, list_agents, update_agent } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

type AgentRow = typeof agents.$inferSelect;

export type PublicAgent = {
  agent_id: string;
  slug: string;
  name: string;
  description: string | null;
  created_time: Date;
};

export const update_agent_body_schema = z
  .strictObject({
    name: z.string().min(1).max(160).optional(),
    instructions: z.string().min(1).max(12000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send name, instructions, or both.');

export const public_agent_routes = new Hono<ApiEnv>()
  .get('/v1/agents', key_authed_route('agents.read', list_public_agents))
  .get('/v1/agents/:agent_slug', key_authed_route('agents.read', read_public_agent))
  .patch(
    '/v1/agents/:agent_slug',
    key_authed_tool_route('agents.write', 'update_agent', update_public_agent),
  );

async function list_public_agents(c: Context<ApiEnv>, api_key: ApiKey) {
  const agents = await list_agents(c.get('db'), api_key.workspace_id);
  return c.json(ok(agents.map(public_agent)));
}

async function read_public_agent(c: Context<ApiEnv>, api_key: ApiKey) {
  return c.json(ok(public_agent(await find_agent_or_raise(c, api_key))));
}

async function update_public_agent(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, update_agent_body_schema);
  const agent = await find_agent_or_raise(c, api_key);
  const updated = await update_agent(c.get('db'), {
    workspace_id: agent.workspace_id,
    agent_id: agent.agent_id,
    ...(body.name ? { agent_name: body.name } : {}),
    ...(body.instructions ? { system_prompt: body.instructions } : {}),
    actor_id: api_key.api_key_id,
  });
  return c.json(ok(public_agent(updated)));
}

async function find_agent_or_raise(c: Context<ApiEnv>, api_key: ApiKey): Promise<AgentRow> {
  const agent = await find_agent_by_slug(
    c.get('db'),
    api_key.workspace_id,
    require_route_param(c, 'agent_slug'),
  );
  if (!agent) throw new NotFoundError('Agent');
  return agent;
}

export function public_agent(agent: AgentRow): PublicAgent {
  return {
    agent_id: agent.agent_id,
    slug: agent.agent_slug,
    name: agent.agent_name,
    description: agent.agent_description,
    created_time: agent.created_time,
  };
}
