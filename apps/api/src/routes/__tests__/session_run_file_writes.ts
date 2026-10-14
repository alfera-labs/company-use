import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_local_session_env } from '@agent-core/environment/local_session_env';
import type { Database } from '@coworker/core/db/connection';
import { create_run, get_session } from '@coworker/core/db/queries/sessions';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';

/**
 * Starts a run of the session and returns its two ways to write a file: the coworker's own
 * `workspace-write_file` and `workspace-run_command`. Both write a workspace folder on this
 * machine: the tools of a Docker self-host write a host folder the same way.
 */
export async function start_session_run_that_writes_files(
  db: Database,
  ids: { workspace_id: string; session_id: string },
) {
  const session = await get_session(db, ids.workspace_id, ids.session_id);
  if (!session) throw new Error(`Session ${ids.session_id} is not in the workspace.`);
  const owner = { ...ids, agent_id: session.agent_id, actor_id: session.created_by };
  await seed_runtime_tool_catalog(db);
  const run = await create_run(db, { ...owner, trigger_type: 'user_message' });
  const workspace_folder = mkdtempSync(join(tmpdir(), 'self-host-workspace-'));
  const environment = {
    ...create_local_session_env({
      workspace_root: workspace_folder,
      working_directory: workspace_folder,
      metadata: { workspace_layout_version: current_workspace_layout.layout_version },
    }),
    env_kind: 'custom' as const,
  };
  const tools = create_runtime_tool_definitions(db, { ...owner, run_id: run.run_id, environment });
  let call_count = 0;

  async function call_tool(tool_name: string, tool_input: Record<string, unknown>) {
    const tool = tools.find((candidate) => candidate.tool_name === tool_name);
    if (!tool?.execute) throw new Error(`${tool_name} is not offered.`);
    call_count += 1;
    return tool.execute(tool_input, {
      run_key: run.run_id,
      session_key: owner.session_id,
      tool_call_id: `model_call_${call_count}`,
      metadata: {},
      environment,
    });
  }

  return {
    write_file: (path: string, content: string) =>
      call_tool('workspace-write_file', { path, content }),
    run_shell_line: (shell_line: string) =>
      call_tool('workspace-run_command', { command: shell_line }),
  };
}
