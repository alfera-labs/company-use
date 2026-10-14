import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import {
  type GoalFile,
  type GoalReview,
  goal_file_path,
  last_progress_line,
} from '@runtime-platform/goals/goal_file_format';
import type { AutomationToolContext } from '@runtime-platform/tools/definitions/automations_support';
import { goal_summary_schema } from '@runtime-platform/tools/definitions/goals_schemas';

export const goals_app_name = 'goals';

const cron_by_review: Record<GoalReview, string> = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
};

export function summarize_goal(goal: GoalFile) {
  return goal_summary_schema.parse({
    slug: goal.slug,
    objective: goal.objective,
    status: goal.status,
    review: goal.review,
    automation_id: goal.automation_id,
    file_path: goal_file_path(goal.slug),
    last_progress: last_progress_line(goal),
  });
}

/**
 * What a goal run wakes up to. The file is the state, so the instruction is four sentences: read
 * it, advance it, write it back, and say anything a person should know as a notification.
 */
export function goal_automation_instruction(slug: string, objective: string): string {
  return [
    `Read ${goal_file_path(slug)} in your workspace. It holds the objective, the constraints, the plan in force and the progress so far.`,
    `The objective is: ${objective}`,
    'Advance the goal by one honest step: do what the plan names next, or say why the plan has to change.',
    `Then update ${goal_file_path(slug)} yourself — edit the plan in place when it changed, and append one dated line under ## Progress saying what moved. A step nobody wrote down did not happen.`,
    'Write a notification for anything a person should know: a plan change they would disagree with, a blocker, a deadline, the goal being done. Silence is right when nothing moved.',
    'Everything outbound — sending, posting, buying, changing anything outside this workspace — is proposed to the person first, never done on your own.',
  ].join('\n');
}

/** The schedule automation behind a goal, created through the same service the agent's own tools use. */
export async function create_goal_automation(
  ctx: AutomationToolContext,
  input: { name: string; slug: string; objective: string; review: GoalReview },
) {
  return read_automation_lifecycle().create_automation(ctx.db, {
    workspace_id: ctx.workspace_id,
    agent_id: ctx.agent_id,
    actor_id: ctx.actor_id,
    automation_name: `Goal: ${input.name}`,
    instruction: goal_automation_instruction(input.slug, input.objective),
    triggers: [{ kind: 'schedule', cron: cron_by_review[input.review] }],
    run_policy: { subject_from: null, when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [],
    judge: null,
    created_via: 'agent_tool',
    metadata: {
      node_key: 'goals-create_goal-1',
      session_id: ctx.session_id,
      run_id: ctx.run_id,
    },
  });
}
