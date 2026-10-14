import { key_authed_route } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_json_body, parse_query } from '@api/lib/validate';
import { refuse_bad_crons, update_automation_body_schema } from '@api/routes/automations';
import { create_automation_input_schema } from '@api/services/automations/automation_input';
import {
  create_api_automation,
  delete_api_automation,
  edit_api_automation,
  get_api_automation,
  list_api_automation_runs,
  list_api_automations,
  trigger_api_automation,
} from '@api/services/automations_api/public_automations';
import { key_authed_tool_route } from '@api/services/policies/alfera_api_tool_gate';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

export const create_automation_body_schema = create_automation_input_schema
  .omit({ workspace_id: true, agent_id: true, actor_id: true, created_via: true, gathering: true })
  .extend({ agent: z.string().min(1).max(200).optional() })
  .superRefine(refuse_bad_crons);

const automation_runs_query_schema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const public_automation_routes = new Hono<ApiEnv>()
  .post(
    '/v1/automations',
    key_authed_tool_route('automations.write', 'create_automation', create_automation),
  )
  .get('/v1/automations', key_authed_route('automations.read', list_automations))
  .get('/v1/automations/:automation_id', key_authed_route('automations.read', read_automation))
  .patch(
    '/v1/automations/:automation_id',
    key_authed_tool_route('automations.write', 'update_automation', edit_automation),
  )
  .delete(
    '/v1/automations/:automation_id',
    key_authed_tool_route('automations.write', 'delete_automation', delete_automation),
  )
  .post(
    '/v1/automations/:automation_id/trigger',
    key_authed_tool_route('automations.write', 'trigger_automation', trigger_automation),
  )
  .get(
    '/v1/automations/:automation_id/runs',
    key_authed_route('automations.read', list_automation_runs),
  );

async function create_automation(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, create_automation_body_schema);
  return c.json(ok(await create_api_automation(c.get('db'), api_key, body)), 201);
}

async function list_automations(c: Context<ApiEnv>, api_key: ApiKey) {
  return c.json(ok(await list_api_automations(c.get('db'), api_key)));
}

async function read_automation(c: Context<ApiEnv>, api_key: ApiKey) {
  const automation = await get_api_automation(c.get('db'), api_key, automation_id(c));
  return c.json(ok(automation));
}

async function edit_automation(c: Context<ApiEnv>, api_key: ApiKey) {
  const body = await parse_json_body(c, update_automation_body_schema);
  const edited = await edit_api_automation(c.get('db'), api_key, automation_id(c), body);
  return c.json(ok(edited));
}

async function delete_automation(c: Context<ApiEnv>, api_key: ApiKey) {
  const deleted = await delete_api_automation(c.get('db'), api_key, automation_id(c));
  return c.json(ok(deleted));
}

// No body. `Idempotency-Key` names the occurrence; without one, every call is a new fire.
async function trigger_automation(c: Context<ApiEnv>, api_key: ApiKey) {
  const fired = await trigger_api_automation(c.get('db'), api_key, {
    automation_id: automation_id(c),
    idempotency_key: c.req.header('idempotency-key')?.trim() || undefined,
  });
  return c.json(ok(fired), 202);
}

async function list_automation_runs(c: Context<ApiEnv>, api_key: ApiKey) {
  const query = parse_query(c, automation_runs_query_schema);
  const page = await list_api_automation_runs(c.get('db'), api_key, {
    automation_id: automation_id(c),
    page: query.page,
    page_size: query.limit,
  });
  return c.json({ ...ok(page.data), next_page: page.next_page, prev_page: page.prev_page });
}

function automation_id(c: Context<ApiEnv>) {
  return require_route_param(c, 'automation_id');
}
