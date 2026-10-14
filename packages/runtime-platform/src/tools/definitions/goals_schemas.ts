import { goal_reviews, goal_statuses } from '@runtime-platform/goals/goal_file_format';
import { z } from 'zod';

const one_line_objective_schema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[^\r\n]*$/u, 'Write the objective on one line, with no line break.');

export const create_goal_input_schema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(160)
    .describe('Short name for the goal, for example "Run a sub-4-hour marathon".'),
  objective: one_line_objective_schema.describe(
    'The outcome being pursued, in one sentence the person would recognise.',
  ),
  constraints: z
    .string()
    .max(2_000)
    .optional()
    .describe('What must hold while pursuing it: budgets, dates, people, things to avoid.'),
  plan: z
    .string()
    .max(2_000)
    .optional()
    .describe('The plan in force right now. Leave it out when the first run should write it.'),
  review: z
    .enum(goal_reviews)
    .default('weekly')
    .describe('How often to come back to this goal and advance it.'),
});

export const list_goals_input_schema = z.strictObject({
  include_done: z.boolean().default(false).describe('Include goals that are done or paused.'),
});

export const update_goal_input_schema = z
  .strictObject({
    slug: z.string().min(1).describe('Goal slug, as returned by list_goals.'),
    status: z.enum(goal_statuses).optional().describe('New status for the goal.'),
    objective: one_line_objective_schema.optional().describe('Replaces the objective.'),
    constraints: z.string().max(2_000).optional().describe('Replaces the constraints.'),
    plan: z.string().max(2_000).optional().describe('Replaces the plan in force.'),
    progress: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('One line saying what moved, appended to the progress log under today’s date.'),
  })
  .superRefine((value, ctx) => {
    const { slug: _slug, ...fields } = value;
    if (Object.values(fields).every((field) => field === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one goal field to update.' });
    }
  });

export const goal_summary_schema = z.object({
  slug: z.string(),
  objective: z.string(),
  status: z.enum(goal_statuses),
  review: z.enum(goal_reviews),
  automation_id: z.string().nullable(),
  file_path: z.string(),
  last_progress: z.string().nullable(),
});

export const goal_output_schema = z.object({ goal: goal_summary_schema });
export const goal_list_output_schema = z.object({ goals: z.array(goal_summary_schema) });
