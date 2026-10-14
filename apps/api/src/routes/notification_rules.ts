import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  authorize_notification_guidance_administration,
  may_change_notification_guidance,
} from '@api/services/workspace_admin_access';
import { env } from '@coworker/config';
import type { DeliveryChannel } from '@coworker/core/db/schema/automation_contracts';
import { delivery_channels_of_a_self_host } from '@runtime-platform/notifications/default_delivery_channel_order';
import {
  type NotificationRulesChanges,
  notification_rules_fields,
  notification_rules_file_name,
  read_body_under_frontmatter,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { save_notification_rules_file } from '@runtime-platform/notifications/save_notification_rules';
import { Hono } from 'hono';
import { z } from 'zod';

// An absent key has to mean "leave it alone". `.partial()` alone would not do that: each field in
// the policy schema carries a DEFAULT, so an omitted key would arrive as its default and quietly
// reset a setting nobody named. Unwrapping the default first is what makes absent mean absent.
const changeable_fields = Object.fromEntries(
  Object.entries(notification_rules_fields.shape).map(([field_name, field]) => [
    field_name,
    (field instanceof z.ZodDefault ? field.def.innerType : field).optional(),
  ]),
) as unknown as {
  [K in keyof NotificationRulesChanges]-?: z.ZodOptional<z.ZodType<NotificationRulesChanges[K]>>;
};

const patch_notification_rules_body_schema = z
  .strictObject({
    ...changeable_fields,
    guidance: z.string().max(4_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Name at least one setting to change.');

function delivery_channels_this_install_offers(): { delivery_channels_set_up?: DeliveryChannel[] } {
  const channels = delivery_channels_of_a_self_host(env);
  return channels ? { delivery_channels_set_up: channels } : {};
}

export const notification_rules_routes = new Hono<ApiEnv>()
  .get('/v1/notification-rules', async (c) => {
    const read = await read_notification_rules_file(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
    });
    return c.json(
      ok({
        policy: read.policy,
        guidance: read.file_text ? read_body_under_frontmatter(read.file_text) : '',
        may_edit_guidance: await may_change_notification_guidance(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          user_id: c.get('user_id'),
        }),
        policy_hash: read.policy_hash,
        file_path: notification_rules_file_name,
        ...delivery_channels_this_install_offers(),
      }),
    );
  })
  .patch(
    '/v1/notification-rules',
    validate_json(patch_notification_rules_body_schema),
    async (c) => {
      const { guidance, ...sent } = c.req.valid('json');
      if (guidance !== undefined) {
        await authorize_notification_guidance_administration(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          user_id: c.get('user_id'),
        });
      }
      const saved = await save_notification_rules_file(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        agent_id: c.get('agent_id'),
        changes: Object.fromEntries(
          Object.entries(sent).filter(([, value]) => value !== undefined),
        ) as NotificationRulesChanges,
        ...(guidance === undefined ? {} : { guidance }),
        changed_by: c.get('user_id'),
      });
      return c.json(ok(saved));
    },
  );
