import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_query } from '@api/lib/validate';
import { get_api_skill, list_api_skills } from '@api/services/skills_api/skill_reads';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

export const skills_query_schema = z.strictObject({ agent: z.string().min(1).max(200).optional() });

export const public_skill_routes = new Hono<ApiEnv>()
  .get('/v1/skills', key_authed_route('skills.read', list_skills))
  .get('/v1/skills/:skill_id', key_authed_route('skills.read', read_skill));

async function list_skills(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, skills_query_schema);
  return c.json(ok(await list_api_skills(c.get('db'), api_key, query.agent)));
}

async function read_skill(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, skills_query_schema);
  const skill = await get_api_skill(c.get('db'), api_key, {
    skill_id: require_route_param(c, 'skill_id'),
    agent_slug: query.agent,
  });
  return c.json(ok(skill));
}
