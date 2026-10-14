import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { Database } from '@coworker/core';
import { upsert_runtime_environment_active_preview } from '@coworker/core/db/queries/sessions';

export async function persist_workspace_tool_side_effects(
  db: Database,
  input: {
    runtime_environment_id?: string;
    result: RuntimeToolResult;
    actor_id: string;
  },
) {
  if (!input.result.ok || !input.runtime_environment_id) return;
  const active_preview = input.result.metadata?.active_preview;
  const preview_port = input.result.metadata?.active_preview_ports?.[0];
  if (!active_preview || preview_port === undefined) return;

  await persist_active_preview(db, {
    runtime_environment_id: input.runtime_environment_id,
    active_preview,
    preview_port,
    mark_environment_running: true,
    actor_id: input.actor_id,
  });
}

export async function persist_active_preview(
  db: Database,
  input: {
    runtime_environment_id: string;
    active_preview: Record<string, unknown>;
    preview_port: number;
    mark_environment_running?: boolean;
    actor_id: string;
  },
) {
  await upsert_runtime_environment_active_preview(db, {
    runtime_environment_id: input.runtime_environment_id,
    active_preview: input.active_preview,
    preview_port: input.preview_port,
    ...(input.mark_environment_running === false ? {} : { environment_status: 'running' }),
    actor_id: input.actor_id,
  });
}
