import { public_env } from '@coworker/config/public_env';
import { AppError, type JsonSchema, type RuntimeToolResult } from '@coworker/shared';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import {
  scheduled_task_summary_schema,
  summarize_scheduled_task,
} from '@runtime-platform/tools/definitions/scheduled_task_summary';
import {
  build_scout_trigger_source,
  find_scout_action_error,
} from '@runtime-platform/tools/policies/scout_action';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const scheduled_tasks_app_name = 'scheduled_tasks';

const create_input_schema = z
  .strictObject({
    name: z.string().min(1).max(160).describe('Short task name shown in the schedule list.'),
    instruction: z.string().min(1).describe('Instruction the agent should run on each fire.'),
    context_digest: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .optional()
      .describe(
        'A few sentences of durable background from this conversation: who asked for the task, what it is for, and the standing preferences it must respect. The run starts fresh, so anything the task needs but the instruction does not say belongs here. No secrets.',
      ),
    cron_expression: z
      .string()
      .min(1)
      .optional()
      .describe('Five-field cron expression in the selected timezone.'),
    run_once_at: z
      .string()
      .datetime()
      .optional()
      .describe('ISO timestamp for a one-time scheduled task.'),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe(
        'IANA timezone, for example Europe/Rome. Only set this when the user explicitly named a timezone or location. Omit it otherwise: the task then automatically runs in the timezone the workspace members actually live in. Never guess UTC.',
      ),
    source_event_id: z
      .string()
      .min(1)
      .optional()
      .describe('Slack event that justified this task. Required for scout actions.'),
  })
  .superRefine((value, ctx) => {
    if (!value.cron_expression && !value.run_once_at) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide cron_expression for recurring tasks or run_once_at for a one-time task.',
      });
    }
  });

const list_input_schema = z.strictObject({
  status: z
    .enum(['enabled', 'disabled', 'error', 'completed'])
    .optional()
    .describe('Optional status filter.'),
  include_completed: z
    .boolean()
    .default(false)
    .describe('Include completed one-time tasks. Defaults to false.'),
});

const edit_input_schema = z
  .strictObject({
    scheduled_task_id: z.string().min(1).describe('Scheduled task id.'),
    name: z.string().min(1).max(160).optional().describe('New task name.'),
    instruction: z.string().min(1).optional().describe('New instruction for future runs.'),
    context_digest: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .optional()
      .describe('New background for future runs. This replaces the stored digest.'),
    cron_expression: z.string().min(1).optional().describe('New five-field cron expression.'),
    run_once_at: z.string().datetime().optional().describe('New one-time ISO timestamp.'),
    timezone: z.string().min(1).optional().describe('New IANA timezone.'),
    status: z.enum(['enabled', 'disabled', 'error']).optional().describe('New task status.'),
  })
  .superRefine((value, ctx) => {
    if (
      !value.name &&
      !value.instruction &&
      !value.context_digest &&
      !value.cron_expression &&
      !value.run_once_at &&
      !value.timezone &&
      !value.status
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide at least one scheduled task field to edit.',
      });
    }
  });

const status_input_schema = z.strictObject({
  scheduled_task_id: z.string().min(1).describe('Scheduled task id.'),
  status: z.enum(['enabled', 'disabled', 'error']).describe('New task status.'),
});

const delete_input_schema = z.strictObject({
  scheduled_task_id: z.string().min(1).describe('Scheduled task id.'),
});

const scheduled_task_output_schema = z.strictObject({
  scheduled_task: scheduled_task_summary_schema,
  dashboard_url: z.string(),
});

const scheduled_task_list_output_schema = z.strictObject({
  count: z.number(),
  scheduled_tasks: z.array(scheduled_task_summary_schema),
});

const delete_scheduled_task_output_schema = z.strictObject({
  scheduled_task_id: z.string(),
  deleted: z.boolean(),
});

const scheduled_task_context_schema = z
  .object({
    db: z.custom<RuntimeToolExecutionContext['db']>(
      (value) => value !== undefined && value !== null,
    ),
    workspace_id: z.string().min(1),
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    actor_id: z.string().min(1),
  })
  .passthrough();

export const create_scheduled_task_tool: RuntimeToolDefinition<typeof create_input_schema> = {
  node_key: 'scheduled_tasks-create_scheduled_task-1',
  node_name: 'create_scheduled_task',
  display_name: 'Create scheduled task',
  description:
    'Creates a scheduled task for this agent. Only use this tool when the user explicitly asks for work to run later or recur on a schedule. Never use it to continue, retry, defer, or finish the current request; keep working in the current run instead. For new recurring work use automations-create_automation-1 with a schedule trigger instead; this tool is for a one-time run_once_at task, and recurring scheduled tasks that already exist keep running. When confirming to the user, include the dashboard_url from the result so they can view and control the task. The result says when the task runs next, in next_run_in_task_timezone: tell the user that time and its time zone. That time is final when this tool answers, so never tell the user to check whether the task will run.',
  category: 'scheduling',
  input_schema: input_json_schema(create_input_schema),
  output_schema: output_json_schema(scheduled_task_output_schema),
  app_name: scheduled_tasks_app_name,
  required_connection: false,
  runtime_handler: 'scheduled_tasks.create_scheduled_task',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: false },
  validate_input: create_input_schema,
  async execute(input, context) {
    const runtime_context = parse_scheduled_task_context(
      context,
      'scheduled_tasks-create_scheduled_task-1',
    );
    if (!runtime_context.success) return runtime_context;
    const ctx = runtime_context.data;

    const source_error = await find_scout_action_error({
      db: ctx.db,
      workspace_id: ctx.workspace_id,
      actor_id: ctx.actor_id,
      source_event_id: input.source_event_id,
      source_context: context?.source_context,
      action: { action_type: 'create_scheduled_task' },
    });
    if (source_error) return source_error;

    const scout_source = build_scout_trigger_source({
      actor_id: ctx.actor_id,
      source_event_id: input.source_event_id,
      source_context: context?.source_context,
    });

    try {
      const trigger = await read_automation_lifecycle().create_scheduled_task(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        task_name: input.name,
        instruction: input.instruction,
        ...(input.context_digest === undefined ? {} : { context_digest: input.context_digest }),
        ...(input.run_once_at === undefined ? {} : { run_once_at: input.run_once_at }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...schedule_expression_input(input),
        source_metadata: {
          node_key: 'scheduled_tasks-create_scheduled_task-1',
          session_id: ctx.session_id,
          run_id: ctx.run_id,
          ...(scout_source ?? {}),
        },
        actor_id: ctx.actor_id,
      });

      return scheduled_task_result(trigger);
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const list_scheduled_tasks_tool: RuntimeToolDefinition<typeof list_input_schema> = {
  node_key: 'scheduled_tasks-list_scheduled_tasks-1',
  node_name: 'list_scheduled_tasks',
  display_name: 'List scheduled tasks',
  description:
    'Lists scheduled tasks for this agent, excluding internal scout triggers. Each task says when it runs next, in next_run_in_task_timezone.',
  category: 'scheduling',
  input_schema: input_json_schema(list_input_schema),
  output_schema: output_json_schema(scheduled_task_list_output_schema),
  app_name: scheduled_tasks_app_name,
  required_connection: false,
  runtime_handler: 'scheduled_tasks.list_scheduled_tasks',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_input_schema,
  async execute(input, context) {
    const runtime_context = parse_scheduled_task_context(
      context,
      'scheduled_tasks-list_scheduled_tasks-1',
    );
    if (!runtime_context.success) return runtime_context;
    const ctx = runtime_context.data;

    try {
      const triggers = await read_automation_lifecycle().list_scheduled_tasks(ctx.db, ctx);
      const scheduled_tasks = triggers
        .filter((trigger) => input.include_completed || trigger.trigger_status !== 'completed')
        .filter((trigger) => !input.status || trigger.trigger_status === input.status)
        .map(summarize_scheduled_task);

      return {
        success: true,
        data: scheduled_task_list_output_schema.parse({
          count: scheduled_tasks.length,
          scheduled_tasks,
        }),
      };
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const edit_scheduled_task_tool: RuntimeToolDefinition<typeof edit_input_schema> = {
  node_key: 'scheduled_tasks-edit_scheduled_task-1',
  node_name: 'edit_scheduled_task',
  display_name: 'Edit scheduled task',
  description:
    'Edits a scheduled task in place, preserving its trigger id and session history. The result says when the task runs next after the edit, in next_run_in_task_timezone.',
  category: 'scheduling',
  input_schema: input_json_schema(edit_input_schema),
  output_schema: output_json_schema(scheduled_task_output_schema),
  app_name: scheduled_tasks_app_name,
  required_connection: false,
  runtime_handler: 'scheduled_tasks.edit_scheduled_task',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: edit_input_schema,
  async execute(input, context) {
    const runtime_context = parse_scheduled_task_context(
      context,
      'scheduled_tasks-edit_scheduled_task-1',
    );
    if (!runtime_context.success) return runtime_context;
    const ctx = runtime_context.data;

    try {
      const trigger = await read_automation_lifecycle().update_scheduled_task(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        trigger_id: input.scheduled_task_id,
        ...(input.name === undefined ? {} : { task_name: input.name }),
        ...(input.status === undefined ? {} : { trigger_status: input.status }),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(input.context_digest === undefined ? {} : { context_digest: input.context_digest }),
        ...(input.run_once_at === undefined ? {} : { run_once_at: input.run_once_at }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...schedule_expression_input(input),
        actor_id: ctx.actor_id,
      });

      return scheduled_task_result(trigger);
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

const set_scheduled_task_status_tool: RuntimeToolDefinition<typeof status_input_schema> = {
  node_key: 'scheduled_tasks-set_scheduled_task_status-1',
  node_name: 'set_scheduled_task_status',
  display_name: 'Set scheduled task status',
  description:
    'Enables, disables, or marks a scheduled task as errored. The result says when the task runs next, in next_run_in_task_timezone, or that it has no next run while it is paused.',
  category: 'scheduling',
  input_schema: input_json_schema(status_input_schema),
  output_schema: output_json_schema(scheduled_task_output_schema),
  app_name: scheduled_tasks_app_name,
  required_connection: false,
  runtime_handler: 'scheduled_tasks.set_scheduled_task_status',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: status_input_schema,
  async execute(input, context) {
    const runtime_context = parse_scheduled_task_context(
      context,
      'scheduled_tasks-set_scheduled_task_status-1',
    );
    if (!runtime_context.success) return runtime_context;
    const ctx = runtime_context.data;

    try {
      const trigger = await read_automation_lifecycle().update_scheduled_task(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        trigger_id: input.scheduled_task_id,
        trigger_status: input.status,
        actor_id: ctx.actor_id,
      });

      return scheduled_task_result(trigger);
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const delete_scheduled_task_tool: RuntimeToolDefinition<typeof delete_input_schema> = {
  node_key: 'scheduled_tasks-delete_scheduled_task-1',
  node_name: 'delete_scheduled_task',
  display_name: 'Delete scheduled task',
  description: 'Deletes a scheduled task.',
  category: 'scheduling',
  input_schema: input_json_schema(delete_input_schema),
  output_schema: output_json_schema(delete_scheduled_task_output_schema),
  app_name: scheduled_tasks_app_name,
  required_connection: false,
  runtime_handler: 'scheduled_tasks.delete_scheduled_task',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: delete_input_schema,
  async execute(input, context) {
    const runtime_context = parse_scheduled_task_context(
      context,
      'scheduled_tasks-delete_scheduled_task-1',
    );
    if (!runtime_context.success) return runtime_context;
    const ctx = runtime_context.data;

    try {
      await read_automation_lifecycle().delete_scheduled_task(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        actor_id: ctx.actor_id,
        trigger_id: input.scheduled_task_id,
      });

      return {
        success: true,
        data: delete_scheduled_task_output_schema.parse({
          scheduled_task_id: input.scheduled_task_id,
          deleted: true,
        }),
      };
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const scheduled_task_tools = [
  create_scheduled_task_tool,
  list_scheduled_tasks_tool,
  edit_scheduled_task_tool,
  set_scheduled_task_status_tool,
  delete_scheduled_task_tool,
] satisfies RuntimeToolDefinition[];

type ScheduledTaskContext = RuntimeToolExecutionContext & { agent_id: string };

function parse_scheduled_task_context(
  context: RuntimeToolExecutionContext | undefined,
  node_key: string,
): (RuntimeToolResult & { success: false }) | { success: true; data: ScheduledTaskContext } {
  if (!context) {
    return tool_error(
      'runtime_context_unavailable',
      `${node_key} requires a runtime execution context.`,
    );
  }

  const parsed_context = scheduled_task_context_schema.safeParse(context);
  if (!parsed_context.success) {
    return tool_error(
      'agent_context_unavailable',
      'Scheduled task tools require an agent context.',
    );
  }

  return { success: true, data: parsed_context.data as ScheduledTaskContext };
}

function input_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
}

function output_json_schema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as JsonSchema;
}

function scheduled_task_result(trigger: TriggerRow): RuntimeToolResult {
  return {
    success: true,
    data: scheduled_task_output_schema.parse({
      scheduled_task: summarize_scheduled_task(trigger),
      dashboard_url: scheduled_task_dashboard_url(trigger.trigger_id),
    }),
  };
}

function scheduled_task_dashboard_url(trigger_id: string) {
  return new URL(`/automations/${trigger_id}`, public_env.NEXT_PUBLIC_APP_URL).toString();
}

function tool_error(code: string, message: string): RuntimeToolResult & { success: false } {
  return { success: false, error: { code, message } };
}

function schedule_expression_input(input: {
  cron_expression?: string | undefined;
  run_once_at?: string | undefined;
}) {
  const schedule_expression = input.cron_expression ?? cron_expression_from_iso(input.run_once_at);
  return schedule_expression === undefined ? {} : { schedule_expression };
}

function cron_expression_from_iso(iso: string | undefined) {
  if (!iso) return undefined;
  const date = new Date(iso);
  return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${
    date.getUTCMonth() + 1
  } *`;
}
