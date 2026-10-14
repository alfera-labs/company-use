import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  get_model,
  type ModelCatalogEnvironment,
  read_workspace_model_catalog_environment,
} from '@api/services/models/model_catalog';
import {
  list_agent_enabled_nodes,
  update_agent_enabled_nodes,
} from '@coworker/core/db/queries/connection_management';
import { get_agent, list_agents, update_agent } from '@coworker/core/db/queries/sessions';
import type { AgentConfigData } from '@coworker/core/db/schema/json_column_types';
import {
  type ModelRoute,
  model_name_schema,
  model_provider_schema,
  model_proxy_schema,
  NotFoundError,
  normalize_model_route,
  ValidationError,
} from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const proxy_model_schema = z.object({
  model_provider: model_provider_schema,
  model_proxy: model_proxy_schema,
  model_name: model_name_schema,
});

const requested_model_schema = proxy_model_schema.transform(normalize_requested_model);

const agent_prompt_schema = z.string().min(1).max(12000);

const update_agent_schema = z.object({
  agent_name: z.string().min(1).max(160).optional(),
  system_prompt: agent_prompt_schema.optional(),
  system_instructions: agent_prompt_schema.optional(),
  // null pins nothing, which hands the choice back to the model use case policy.
  default_model: requested_model_schema.nullable().optional(),
});

const connection_selector_schema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('no_connection_required') }),
  z.object({ strategy: z.literal('specific_connection'), connection_id: z.string().min(1) }),
  z.object({ strategy: z.literal('latest_active_matching_connection') }),
  z.object({ strategy: z.literal('connection_key'), connection_key: z.string().min(1) }),
]);
const agent_enabled_node_schema = z.object({
  node_key: z.string().min(1),
  provider_key: z.enum(['native', 'mcp', 'composio', 'custom_http']),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  connection_selector: connection_selector_schema,
  input_defaults: z.record(z.string(), z.unknown()).default({}),
  approval_policy_override: z.record(z.string(), z.unknown()).nullable().default(null),
});

const update_enabled_nodes_schema = z.object({
  enabled_nodes: z.array(agent_enabled_node_schema),
});

export const agent_routes = new Hono<ApiEnv>()
  .get('/v1/agents', async (c) => {
    const agents = await list_agents(c.get('db'), c.get('workspace_id'));
    return c.json(ok(agents.map(agent_with_its_pinned_model)));
  })
  .get('/v1/agents/:agent_id', async (c) => {
    const agent = await get_agent(c.get('db'), c.get('workspace_id'), c.req.param('agent_id'));
    if (!agent) throw new NotFoundError('Agent');

    return c.json(ok(agent_with_its_pinned_model(agent)));
  })
  .get('/v1/agents/:agent_id/enabled-nodes', async (c) => {
    return c.json(
      ok(
        await list_agent_enabled_nodes(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          agent_id: c.req.param('agent_id'),
        }),
      ),
    );
  })
  .put(
    '/v1/agents/:agent_id/enabled-nodes',
    validate_json(update_enabled_nodes_schema),
    async (c) => {
      const body = c.req.valid('json');
      return c.json(
        ok(
          await update_agent_enabled_nodes(c.get('db'), {
            workspace_id: c.get('workspace_id'),
            agent_id: c.req.param('agent_id'),
            enabled_nodes: body.enabled_nodes,
            actor_id: c.get('user_id'),
          }),
        ),
      );
    },
  )
  .patch('/v1/agents/:agent_id', validate_json(update_agent_schema), async (c) => {
    const body = c.req.valid('json');
    const default_model = body.default_model
      ? await validate_default_model(
          body.default_model,
          await read_workspace_model_catalog_environment(c.get('db'), c.get('workspace_id')),
        )
      : body.default_model;
    const system_prompt = body.system_prompt ?? body.system_instructions;

    const agent = await update_agent(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.req.param('agent_id'),
      ...(body.agent_name ? { agent_name: body.agent_name } : {}),
      ...(system_prompt ? { system_prompt } : {}),
      ...(default_model === undefined ? {} : { default_model }),
      actor_id: c.get('user_id'),
    });

    return c.json(ok(agent_with_its_pinned_model(agent)));
  });

function agent_with_its_pinned_model<
  Agent extends {
    default_model: string | null;
    default_model_provider: string | null;
    default_model_name: string | null;
    agent_config: AgentConfigData;
  },
>(agent: Agent) {
  const { default_model, default_model_provider, default_model_name } = agent;
  const model_proxy = agent.agent_config.model_proxy ?? null;
  const model_name = default_model_name ?? default_model;
  const normalized_route = normalize_model_route({
    model_provider: default_model_provider,
    model_proxy,
    model_name,
  });

  return {
    ...agent,
    default_model_route: normalized_route.success ? normalized_route.route : null,
  };
}

async function validate_default_model(
  request: ModelRoute | null | undefined,
  model_environment: ModelCatalogEnvironment,
) {
  if (!request) throw new ValidationError('A default model is required');

  const model = await get_model({
    model_proxy: request.model_proxy,
    model_id: request.model_name,
    model_environment,
  });
  if (model.model_provider !== request.model_provider) {
    throw new ValidationError(
      `Model ${model.model_id} is provided by ${model.model_provider}, not ${request.model_provider}`,
    );
  }

  return {
    model_provider: model.model_provider,
    model_proxy: model.model_proxy,
    model_name: model.model_id,
  };
}

function normalize_requested_model(
  request: z.infer<typeof proxy_model_schema>,
  context: z.RefinementCtx,
) {
  const normalized = normalize_model_route(request);
  if (normalized.success && normalized.route) return normalized.route;

  for (const issue of normalized.success ? [] : normalized.issues) {
    context.addIssue({ code: 'custom', message: issue.message, path: [issue.field] });
  }
  return z.NEVER;
}
