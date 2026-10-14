import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { parse_json_text, validate_json } from '@api/lib/validate';
import type { Database } from '@coworker/core';
import {
  read_workspace_inbound_email_settings,
  write_workspace_inbound_email_settings,
} from '@coworker/core/db/queries/workspace_inbound_email_settings';
import {
  create_workspace_email_address,
  find_workspace_email_address,
  inbound_email_username_schema,
  rename_workspace_email_address,
} from '@coworker/runtime-platform';
import { Hono } from 'hono';
import { z } from 'zod';

const create_address_schema = z.object({
  username: inbound_email_username_schema.optional(),
});

const update_address_schema = z
  .object({
    username: inbound_email_username_schema.optional(),
    enabled: z.boolean().optional(),
    attribution_enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one of username, enabled, attribution_enabled.',
  });

async function read_workspace_email_address_state(db: Database, workspace_id: string) {
  const [address, settings] = await Promise.all([
    find_workspace_email_address(db, workspace_id),
    read_workspace_inbound_email_settings(db, workspace_id),
  ]);
  return { ...address, ...settings, created: false };
}

export const workspace_email_address_routes = new Hono<ApiEnv>()
  .get('/v1/workspace/email-address', async (c) => {
    return c.json(ok(await read_workspace_email_address_state(c.get('db'), c.get('workspace_id'))));
  })
  .post('/v1/workspace/email-address', async (c) => {
    const { username } = await parse_create_address_body(c.req.raw);
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const address = await create_workspace_email_address(db, {
      workspace_id,
      ...(username === undefined ? {} : { username }),
      actor_id: c.get('user_id'),
    });
    const settings = await read_workspace_inbound_email_settings(db, workspace_id);
    return c.json(ok({ ...address, ...settings, available: true }), address.created ? 201 : 200);
  })
  .patch('/v1/workspace/email-address', validate_json(update_address_schema), async (c) => {
    const { username, enabled, attribution_enabled } = c.req.valid('json');
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const actor_id = c.get('user_id');

    if (username !== undefined) {
      await rename_workspace_email_address(db, { workspace_id, username, actor_id });
    }
    if (enabled !== undefined || attribution_enabled !== undefined) {
      await write_workspace_inbound_email_settings(db, {
        workspace_id,
        actor_id,
        settings: {
          ...(enabled === undefined ? {} : { enabled }),
          ...(attribution_enabled === undefined ? {} : { attribution_enabled }),
        },
      });
    }
    return c.json(ok(await read_workspace_email_address_state(db, workspace_id)));
  });

async function parse_create_address_body(request: Request) {
  const body_text = await request.text();
  if (!body_text.trim()) return { username: undefined };

  return parse_json_text(body_text, create_address_schema);
}
