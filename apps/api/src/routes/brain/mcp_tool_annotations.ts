import type { McpToolAnnotations } from '@api/routes/brain/brain_tool';

/** Only reads rows of this workspace; changes nothing and reaches nothing outside it. */
export const reads_the_workspace: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/** Queues a run and writes its rows, but the run may only read the workspace's own memory. */
export const starts_a_workspace_only_run: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Destructive: the agent acts with its full tools, so it may send email or messages that
 * cannot be unsent. Open world: it can browse the web and write to people outside the workspace.
 */
export const starts_agent_work_that_cannot_be_unsent: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};

/**
 * Not destructive: it only saves a job, which can be paused or deleted. Open world: every time
 * a trigger fires, the job runs the agent with its web and email reach.
 */
export const saves_a_job_that_runs_the_agent_later: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};
