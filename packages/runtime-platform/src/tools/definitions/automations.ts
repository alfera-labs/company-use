import { list_automations } from '@coworker/core/db/queries/automation_reads';
import { AppError } from '@coworker/shared';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import { default_email_conditions } from '@runtime-platform/tools/definitions/automations_condition_defaults';
import { list_automations_tool } from '@runtime-platform/tools/definitions/automations_list';
import {
  delete_automation_tool,
  edit_automation_tool,
  run_automation_now_tool,
  set_automation_status_tool,
} from '@runtime-platform/tools/definitions/automations_manage';
import { automation_result } from '@runtime-platform/tools/definitions/automations_readback';
import {
  automation_output_schema,
  create_automation_input_schema,
} from '@runtime-platform/tools/definitions/automations_schemas';
import {
  new_run_policy,
  run_gathering,
  service_trigger,
} from '@runtime-platform/tools/definitions/automations_service_input';
import {
  agent_automation_limit,
  ask_the_person_error,
  automations_app_name,
  find_subject_from,
  input_json_schema,
  is_a_person_turn,
  output_json_schema,
  read_automation_context,
  read_inherited_authority,
  tool_error,
} from '@runtime-platform/tools/definitions/automations_support';
import { list_trigger_types_tool } from '@runtime-platform/tools/definitions/automations_trigger_types';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const create_automation_tool: RuntimeToolDefinition<typeof create_automation_input_schema> =
  {
    node_key: 'automations-create_automation-1',
    node_name: 'create_automation',
    display_name: 'Create automation',
    description: [
      'Sets up standing work: one instruction that runs every time any of its triggers fires.',
      'Use it when the user asks for something to keep happening, or when you want to watch a thread you just opened.',
      'Find node_key with list_trigger_types first, and write conditions rules that drop what the user never wants to be woken for.',
      "For Slack messages use slack-message_received-1 (the workspace's own Slack app); composio_slack-* nodes need a separate Composio Slack account.",
      'Never poll on a cron for something a trigger exists for: "after a meeting" is googlecalendar-event_offset-1 / outlook-event_offset-1, "when mail arrives" is a mail trigger. A schedule is only for work that has no event.',
      'When the instruction names an app that is not connected (a CRM, a calendar, a notes tool), create its connection link with runtime-create_connection too, even when the person said "if connected": the automation is worth more with it, and they decide by clicking or not.',
      'The instruction must stand on its own: the run starts fresh and must say that everything outbound is proposed to the person first, unless the person asked for sends_without_asking; telling the person themselves is never outbound.',
      'A trigger of kind "webhook" gives the automation its own URL and bearer secret (returned as webhook_url and webhook_secret): show both to the person, for systems that can POST JSON. Say the truth about the secret: the tool returns it only now and never again, it stays in this chat, and anyone who can read this chat can read it. Never say it is shown only once. To get a new one, replace the trigger, which also changes the URL. When the result has webhook_url_note, say that sentence to the person too.',
      'judge_question is one yes/no question, asked only for subjects with no conversation yet. When the trigger fires on every new message and the instruction only applies to some of them ("when an invoice arrives"), put that condition in judge_question: without it every message starts a full run.',
      'Read the readback in the result back to the user.',
    ].join(' '),
    category: 'scheduling',
    input_schema: input_json_schema(create_automation_input_schema),
    output_schema: output_json_schema(automation_output_schema),
    app_name: automations_app_name,
    required_connection: false,
    runtime_handler: 'automations.create_automation',
    approval_policy: { mode: 'none' },
    source_context_policy: { mode: 'current_turn' },
    metadata: { safe_for_first_milestone: false },
    validate_input: create_automation_input_schema,
    async execute(input, context) {
      const parsed_context = read_automation_context(context, 'automations-create_automation-1');
      if (!parsed_context.success) return parsed_context;
      const ctx = parsed_context.data;
      const inherited = is_a_person_turn(ctx) ? null : read_inherited_authority(ctx);
      if (!is_a_person_turn(ctx) && !inherited) {
        return ask_the_person_error('create standing work of its own');
      }

      const own_automations = await list_automations(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        created_via: 'agent_tool',
      });
      if (own_automations.length >= agent_automation_limit) {
        return tool_error(
          'automation_limit_reached',
          `You already keep ${agent_automation_limit} automations of your own. Delete one before adding another.`,
        );
      }

      try {
        const node_keys = input.triggers.flatMap((trigger) =>
          trigger.kind === 'app_event' ? [trigger.node_key] : [],
        );
        const subject_from = await find_subject_from(ctx.db, {
          workspace_id: ctx.workspace_id,
          node_keys,
        });
        const rules =
          input.rules ??
          (await default_email_conditions(ctx.db, {
            workspace_id: ctx.workspace_id,
            agent_id: ctx.agent_id,
            node_keys,
          }));
        const created = await read_automation_lifecycle().create_automation(ctx.db, {
          workspace_id: ctx.workspace_id,
          agent_id: ctx.agent_id,
          actor_id: inherited?.grantor_actor_id ?? ctx.actor_id,
          automation_name: input.name,
          instruction: input.instruction,
          triggers: input.triggers.map(service_trigger),
          gathering: run_gathering(ctx),
          run_policy: new_run_policy(subject_from, input.sends_without_asking),
          conditions: rules,
          judge: input.judge_question
            ? {
                question: input.judge_question,
                ...(input.run_at_or_above === undefined
                  ? {}
                  : { run_at_or_above: input.run_at_or_above }),
              }
            : null,
          created_via: input.mined_from_notification_id ? 'automation_miner' : 'agent_tool',
          metadata: {
            node_key: 'automations-create_automation-1',
            session_id: ctx.session_id,
            run_id: ctx.run_id,
            ...(input.mined_from_notification_id
              ? { mined_from_notification_id: input.mined_from_notification_id }
              : {}),
            ...(inherited?.parent_automation_id
              ? {
                  parent_automation_id: inherited.parent_automation_id,
                  expires_with_parent: true,
                }
              : {}),
          },
        });

        return await automation_result(ctx.db, created.automation, created.triggers);
      } catch (error) {
        if (error instanceof AppError) return tool_error(error.code, error.message);
        throw error;
      }
    },
  };

export const automation_tools = [
  create_automation_tool,
  list_automations_tool,
  edit_automation_tool,
  set_automation_status_tool,
  delete_automation_tool,
  run_automation_now_tool,
  list_trigger_types_tool,
] satisfies RuntimeToolDefinition[];

export { list_automations_tool } from '@runtime-platform/tools/definitions/automations_list';
export {
  delete_automation_tool,
  edit_automation_tool,
  run_automation_now_tool,
  set_automation_status_tool,
} from '@runtime-platform/tools/definitions/automations_manage';
export { list_trigger_types_tool } from '@runtime-platform/tools/definitions/automations_trigger_types';
