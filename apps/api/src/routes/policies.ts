import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { assert_policy_manager } from '@api/services/policies/policy_authority';
import { one_rule } from '@api/services/policies/policy_rule_ownership';
import {
  change_policies_and_record_event,
  delete_policy_and_record_event,
  set_policy_and_record_event,
} from '@api/services/policies/policy_service';
import { get_policy, list_policies } from '@coworker/core/db/queries/policies';
import { policy_modes, policy_scope_types } from '@coworker/core/db/schema/policies';
import { Hono } from 'hono';
import { z } from 'zod';

const list_policies_schema = z
  .object({
    resource_type: z.string().min(1).optional(),
    resource_id: z.string().min(1).optional(),
    scope_type: z.enum(policy_scope_types).optional(),
    scope_id: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

const set_policy_schema = z
  .object({
    resource_type: z.string().min(1),
    resource_id: z.string().min(1),
    scope_type: z.enum(policy_scope_types),
    scope_id: z.string().min(1),
    policy_mode: z.enum(policy_modes),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const change_policies_schema = z
  .object({
    scope_type: z.enum(policy_scope_types),
    scope_id: z.string().min(1),
    delete_policy_ids: z.array(z.string().min(1)).max(500),
    set_policies: z
      .array(
        z
          .object({
            resource_type: z.string().min(1),
            resource_id: z.string().min(1),
            policy_mode: z.enum(policy_modes),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const policy_routes = new Hono<ApiEnv>()
  .get('/v1/policies', validate_query(list_policies_schema), async (c) => {
    const query = c.req.valid('query');
    return c.json(
      ok(
        await list_policies(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          ...(query.resource_type ? { resource_type: query.resource_type } : {}),
          ...(query.resource_id ? { resource_id: query.resource_id } : {}),
          ...(query.scope_type ? { scope_type: query.scope_type } : {}),
          ...(query.scope_id ? { scope_id: query.scope_id } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        }),
      ),
    );
  })
  .put('/v1/policies', validate_json(set_policy_schema), async (c) => {
    const body = c.req.valid('json');
    await assert_policy_manager(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      targets: one_rule(body.resource_type, body.resource_id),
    });
    const policy = await set_policy_and_record_event(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      resource_type: body.resource_type,
      resource_id: body.resource_id,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      policy_mode: body.policy_mode,
      ...(body.metadata ? { metadata: body.metadata } : {}),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(policy));
  })
  .put('/v1/policies/batch', validate_json(change_policies_schema), async (c) => {
    const body = c.req.valid('json');
    await assert_policy_manager(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      targets: { resources: body.set_policies, policy_ids: body.delete_policy_ids },
    });
    return c.json(
      ok(
        await change_policies_and_record_event(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          ...body,
          actor_id: c.get('user_id'),
        }),
      ),
    );
  })
  .delete('/v1/policies/:policy_id', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const policy = await get_policy(db, {
      workspace_id,
      policy_id: c.req.param('policy_id'),
    });
    if (policy) {
      await assert_policy_manager(db, {
        workspace_id,
        user_id: c.get('user_id'),
        scope_type: policy.scope_type as (typeof policy_scope_types)[number],
        scope_id: policy.scope_id,
        targets: { resources: [], policy_ids: [policy.policy_id] },
      });
    }
    return c.json(
      ok(
        await delete_policy_and_record_event(db, {
          workspace_id,
          policy_id: c.req.param('policy_id'),
          actor_id: c.get('user_id'),
        }),
      ),
    );
  });
