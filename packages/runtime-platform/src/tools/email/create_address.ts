import { AppError } from '@coworker/shared';
import { create_workspace_email_address } from '@runtime-platform/channels/email/address_lifecycle';
import { inbound_email_username_schema } from '@runtime-platform/channels/email/inbound_address';
import { refuse_a_plain_member_in_team_mode } from '@runtime-platform/tools/team_admin_gate';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.strictObject({
  username: inbound_email_username_schema.optional(),
});

export const email_create_address_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'email-create_address-1',
  node_name: 'create_address',
  display_name: 'Create workspace email address',
  description:
    "Creates this workspace's own email address on the managed domain (or returns the existing one). Mail sent to it starts a conversation with you, and you reply from it. Use it whenever a task needs an email address and no mail provider is connected — newsletters, vendor contacts, receiving reports. The address is permanent once created.",
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        minLength: 3,
        maxLength: 64,
        pattern: '^[a-z0-9][a-z0-9._-]*[a-z0-9]$',
        description:
          'Optional local part, e.g. "acme" for acme@<domain>. Defaults to the workspace slug. 3-64 lowercase letters, numbers, dots, dashes, underscores.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      email_address: { type: 'string' },
      created: { type: 'boolean' },
      summary: { type: 'string' },
    },
    required: ['email_address', 'created', 'summary'],
  },
  app_name: 'email',
  required_connection: false,
  runtime_handler: 'email.create_address',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'email-create_address-1 requires a runtime execution context.',
        },
      };
    }

    const refusal = await refuse_a_plain_member_in_team_mode(
      context,
      'Only an owner or an admin can set the address the team gets mail at. Ask one of them.',
    );
    if (refusal) return refusal;

    try {
      const address = await create_workspace_email_address(context.db, {
        workspace_id: context.workspace_id,
        ...(input.username === undefined ? {} : { username: input.username }),
        actor_id: context.actor_id,
      });
      return {
        success: true,
        data: {
          ...address,
          summary: address.created
            ? `Created ${address.email_address}. Mail sent there starts a conversation with you, and you reply from it.`
            : `This workspace already has ${address.email_address}. Mail sent there reaches you.`,
        },
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  },
};
