import { list_automations } from '@coworker/core/db/queries/automation_reads';
import { to_document_slug } from '@coworker/memory/documents/slug_rules';
import { AppError } from '@coworker/shared';
import { type GoalFile, progress_line } from '@runtime-platform/goals/goal_file_format';
import {
  list_goal_files,
  read_goal_file,
  save_goal_file,
} from '@runtime-platform/goals/goal_files';
import {
  agent_automation_limit,
  ask_the_person_error,
  input_json_schema,
  is_a_person_turn,
  output_json_schema,
  read_automation_context,
  tool_error,
} from '@runtime-platform/tools/definitions/automations_support';
import {
  create_goal_input_schema,
  goal_list_output_schema,
  goal_output_schema,
  list_goals_input_schema,
  update_goal_input_schema,
} from '@runtime-platform/tools/definitions/goals_schemas';
import {
  create_goal_automation,
  goals_app_name,
  summarize_goal,
} from '@runtime-platform/tools/definitions/goals_support';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const create_goal_tool: RuntimeToolDefinition<typeof create_goal_input_schema> = {
  node_key: 'goals-create_goal-1',
  node_name: 'create_goal',
  display_name: 'Create goal',
  description: [
    'Starts a goal: writes goals/<slug>.md with the objective, the constraints and the plan, and sets up the schedule that comes back to it, advances it and updates the file.',
    'Use it when the person names an outcome they want pursued over time rather than one job done now.',
    'Read the objective back to them, and say when it will next be looked at.',
  ].join(' '),
  category: 'scheduling',
  input_schema: input_json_schema(create_goal_input_schema),
  output_schema: output_json_schema(goal_output_schema),
  app_name: goals_app_name,
  required_connection: false,
  runtime_handler: 'goals.create_goal',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: false },
  validate_input: create_goal_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'goals-create_goal-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;
    if (!is_a_person_turn(ctx)) return ask_the_person_error('start a goal of its own');

    const slug = to_document_slug(input.name);
    const existing = await read_goal_file(ctx.db, {
      workspace_id: ctx.workspace_id,
      agent_id: ctx.agent_id,
      slug,
    });
    if (existing) {
      return tool_error(
        'goal_already_exists',
        `A goal called "${input.name}" is already written at goals/${slug}.md. Update it instead.`,
      );
    }
    const own_automations = await list_automations(ctx.db, {
      workspace_id: ctx.workspace_id,
      agent_id: ctx.agent_id,
      created_via: 'agent_tool',
    });
    if (own_automations.length >= agent_automation_limit) {
      return tool_error(
        'automation_limit_reached',
        `You already keep ${agent_automation_limit} automations of your own. Delete one before starting a goal.`,
      );
    }

    try {
      const created = await create_goal_automation(ctx, {
        name: input.name.slice(0, 150),
        slug,
        objective: input.objective,
        review: input.review,
      });
      const goal: GoalFile = {
        slug,
        objective: input.objective,
        status: 'active',
        review: input.review,
        automation_id: created.automation.automation_id,
        constraints: input.constraints ?? '',
        plan: input.plan ?? '',
        progress: [progress_line('goal started', new Date())],
      };
      await save_goal_file(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        goal,
      });
      return { success: true, data: goal_output_schema.parse({ goal: summarize_goal(goal) }) };
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const list_goals_tool: RuntimeToolDefinition<typeof list_goals_input_schema> = {
  node_key: 'goals-list_goals-1',
  node_name: 'list_goals',
  display_name: 'List goals',
  description:
    "Lists the goals this workspace is pursuing, with each one's objective, status and last progress line. Call it before starting a goal that may already exist.",
  category: 'scheduling',
  input_schema: input_json_schema(list_goals_input_schema),
  output_schema: output_json_schema(goal_list_output_schema),
  app_name: goals_app_name,
  required_connection: false,
  runtime_handler: 'goals.list_goals',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_goals_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'goals-list_goals-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;
    const goals = await list_goal_files(ctx.db, {
      workspace_id: ctx.workspace_id,
      agent_id: ctx.agent_id,
    });
    const shown = input.include_done ? goals : goals.filter((goal) => goal.status === 'active');
    return {
      success: true,
      data: goal_list_output_schema.parse({ goals: shown.map(summarize_goal) }),
    };
  },
};

export const update_goal_tool: RuntimeToolDefinition<typeof update_goal_input_schema> = {
  node_key: 'goals-update_goal-1',
  node_name: 'update_goal',
  display_name: 'Update goal',
  description: [
    'Changes a goal: its status, its objective, its constraints, the plan in force, or one line appended to the progress log.',
    'Use it from a goal run to record what moved, and when the person changes what they want.',
  ].join(' '),
  category: 'scheduling',
  input_schema: input_json_schema(update_goal_input_schema),
  output_schema: output_json_schema(goal_output_schema),
  app_name: goals_app_name,
  required_connection: false,
  runtime_handler: 'goals.update_goal',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: update_goal_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'goals-update_goal-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const read = await read_goal_file(ctx.db, {
      workspace_id: ctx.workspace_id,
      agent_id: ctx.agent_id,
      slug: input.slug,
    });
    if (!read?.goal) {
      return tool_error('goal_not_found', `There is no goal at goals/${input.slug}.md.`);
    }
    const goal: GoalFile = {
      ...read.goal,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.objective === undefined ? {} : { objective: input.objective }),
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.plan === undefined ? {} : { plan: input.plan }),
      progress: input.progress
        ? [...read.goal.progress, progress_line(input.progress, new Date())]
        : read.goal.progress,
    };
    try {
      await save_goal_file(ctx.db, {
        workspace_id: ctx.workspace_id,
        agent_id: ctx.agent_id,
        goal,
      });
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
    return { success: true, data: goal_output_schema.parse({ goal: summarize_goal(goal) }) };
  },
};

export const goal_tools = [create_goal_tool, list_goals_tool, update_goal_tool];
