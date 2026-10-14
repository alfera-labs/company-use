import { get_agent, update_agent } from '@coworker/core/db/queries/sessions';
import { refuse_a_plain_member_in_team_mode } from '@runtime-platform/tools/team_admin_gate';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const agent_name_schema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} .,'&_-]*$/u, {
    message: 'Use letters, numbers, spaces, and simple punctuation only.',
  });

const input_schema = z.object({
  agent_name: agent_name_schema,
});

export const runtime_set_agent_name_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-set_agent_name-1',
  node_name: 'set_agent_name',
  display_name: 'Set agent name',
  description:
    'Rename this agent for the whole workspace. Use ONLY when the user explicitly asks to rename you or call you something else. The Slack @mention handle cannot change; the new name applies to how you refer to yourself.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        minLength: 1,
        maxLength: 40,
        description: 'The new name, e.g. "Jarvis". Letters, numbers, spaces, simple punctuation.',
      },
    },
    required: ['agent_name'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      agent_name: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['agent_name', 'summary'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.set_agent_name',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-set_agent_name-1 requires a runtime execution context.',
        },
      };
    }

    const agent = context.agent_id
      ? await get_agent(context.db, context.workspace_id, context.agent_id)
      : undefined;
    if (!agent) {
      return {
        success: false,
        error: { code: 'agent_not_found', message: 'No agent in this run to rename.' },
      };
    }

    const refusal = await refuse_a_plain_member_in_team_mode(
      context,
      'Only an owner or an admin can rename the coworker the team shares. Ask one of them.',
    );
    if (refusal) return refusal;

    await update_agent(context.db, {
      workspace_id: context.workspace_id,
      agent_id: agent.agent_id,
      agent_name: input.agent_name,
      actor_id: context.actor_id,
    });

    return {
      success: true,
      data: {
        agent_name: input.agent_name,
        summary: `Renamed to ${input.agent_name} for this workspace. In Slack the @mention handle stays the same; the name applies to how the agent refers to itself.`,
      },
    };
  },
};
