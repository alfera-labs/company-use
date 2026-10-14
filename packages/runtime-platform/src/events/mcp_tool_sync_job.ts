import type { Database, events as events_table } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { sync_mcp_server_tools } from '@runtime-platform/connections/mcp_tool_sync';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { z } from 'zod';

const mcp_tool_sync_job_handler = 'mcp_tool_sync';

const log = create_logger('mcp_tool_sync_job');

const sync_actor_id = 'system:mcp_tool_sync';

const mcp_tool_sync_event_body_schema = z
  .object({
    app_id: z.string().min(1),
  })
  .strict();

export async function enqueue_mcp_tool_sync(
  db: Database,
  input: { workspace_id: string; app_id: string; actor_id: string },
) {
  const result = await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.workspace_id,
      source: 'connection',
      source_event_id: input.app_id,
      event_type: 'mcp.tool_sync_requested',
      queue_key: `mcp_tool_sync:${input.app_id}`,
      actor_key: input.actor_id,
      event_body: { app_id: input.app_id },
      event_jobs: [{ job_handler: mcp_tool_sync_job_handler }],
    },
    find_event_job_handler,
  );

  return { enqueued: result.event_jobs.length > 0, event_jobs: result.event_jobs };
}

export async function run_mcp_tool_sync_job(input: {
  db: Database;
  workspace_id: string;
  events: (typeof events_table.$inferSelect)[];
}): Promise<EventJobHandlerResult> {
  const app_ids = read_requested_app_ids(input.events);
  if (app_ids.length === 0) {
    return { job_status: 'done', result_data: { skipped_because: 'no_readable_sync_event' } };
  }

  const outcomes = [];
  for (const app_id of app_ids) {
    outcomes.push(
      await sync_mcp_server_tools({
        db: input.db,
        workspace_id: input.workspace_id,
        app_id,
        actor_id: sync_actor_id,
      }),
    );
  }

  const failures = outcomes.filter((outcome) => !outcome.synced);
  if (failures.length > 0) {
    log.warn('Some MCP servers could not be synced', {
      workspace_id: input.workspace_id,
      failed: failures.length,
      of: outcomes.length,
    });
  }

  return { job_status: 'done', result_data: { outcomes } };
}

function read_requested_app_ids(events: (typeof events_table.$inferSelect)[]): string[] {
  const app_ids = new Set<string>();
  for (const event of events) {
    const parsed = mcp_tool_sync_event_body_schema.safeParse(event.event_body);
    if (!parsed.success) {
      log.error('Unreadable MCP tool sync event body', { event_id: event.event_id });
      continue;
    }
    app_ids.add(parsed.data.app_id);
  }
  return [...app_ids];
}
