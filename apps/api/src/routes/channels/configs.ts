import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  create_channel,
  list_channels,
  update_channel_status,
} from '@coworker/core/db/queries/channels';
import { ValidationError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const channel_object_schema = z.record(z.string(), z.unknown());

const create_channel_schema = z.object({
  connection_id: z.string().min(1).nullable().optional(),
  channel_provider_key: z.string().min(1).max(80),
  channel_name: z.string().min(1).max(160).nullable().optional(),
  external_account_id: z.string().min(1).nullable().optional(),
  external_conversation_id: z.string().min(1).nullable().optional(),
  external_thread_id: z.string().min(1).nullable().optional(),
  conversation_scope: z.enum(['any', 'dm', 'group', 'channel', 'thread']).optional(),
  routing_priority: z.number().int().optional(),
  target_kind: z.enum(['agent', 'workflow', 'node', 'system']).optional(),
  target_id: z.string().min(1).optional(),
  channel_source: channel_object_schema.optional(),
  channel_config: channel_object_schema.optional(),
  channel_target: channel_object_schema.optional(),
  metadata: channel_object_schema.optional(),
});

const update_channel_schema = z.object({
  channel_status: z.enum(['enabled', 'disabled', 'error']),
});

export const channel_config_routes = new Hono<ApiEnv>();

channel_config_routes.get('/v1/channels', async (c) => {
  return c.json(ok(await list_channels(c.get('db'), c.get('workspace_id'))));
});

channel_config_routes.post('/v1/channels', validate_json(create_channel_schema), async (c) => {
  const body = c.req.valid('json');
  const target_kind = body.target_kind ?? 'agent';
  const target_id = body.target_id ?? default_channel_target_id(target_kind, c.get('agent_id'));
  const channel = await create_channel(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    channel_provider_key: body.channel_provider_key,
    target_kind,
    target_id,
    ...(body.connection_id !== undefined ? { connection_id: body.connection_id } : {}),
    ...(body.channel_name !== undefined ? { channel_name: body.channel_name } : {}),
    ...(body.external_account_id !== undefined
      ? { external_account_id: body.external_account_id }
      : {}),
    ...(body.external_conversation_id !== undefined
      ? { external_conversation_id: body.external_conversation_id }
      : {}),
    ...(body.external_thread_id !== undefined
      ? { external_thread_id: body.external_thread_id }
      : {}),
    ...(body.conversation_scope ? { conversation_scope: body.conversation_scope } : {}),
    ...(body.routing_priority !== undefined ? { routing_priority: body.routing_priority } : {}),
    ...(body.channel_source ? { channel_source: body.channel_source } : {}),
    ...(body.channel_config ? { channel_config: body.channel_config } : {}),
    ...(body.channel_target ? { channel_target: body.channel_target } : {}),
    ...(body.metadata ? { metadata: body.metadata } : {}),
    actor_id: c.get('user_id'),
  });

  return c.json(ok(channel), 201);
});

channel_config_routes.patch(
  '/v1/channels/:channel_id',
  validate_json(update_channel_schema),
  async (c) => {
    const body = c.req.valid('json');
    const channel = await update_channel_status(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      channel_id: c.req.param('channel_id'),
      channel_status: body.channel_status,
      actor_id: c.get('user_id'),
    });

    return c.json(ok(channel));
  },
);

function default_channel_target_id(target_kind: string, agent_id: string) {
  if (target_kind === 'agent') return agent_id;
  throw new ValidationError('target_id is required for workflow, node, and system targets');
}
