import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { agent_has_live_run } from '@coworker/core/db/queries/agent_live_runs';
import type { get_runtime_environment } from '@coworker/core/db/queries/sessions';
import { create_browser_state_config } from '@runtime-platform/browser/browser_state_config';
import { stop_e2b_sandbox } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  read_agent_workspace_path,
  read_volume_id,
  read_volume_root_path,
  read_workspace_layout_version,
} from '@runtime-platform/storage/volume_metadata';

type RuntimeEnvironment = NonNullable<Awaited<ReturnType<typeof get_runtime_environment>>>;

/** Stops a volume-backed sandbox; a stuck browser-state claim is reclaimed only with no live peer. */
export async function stop_e2b_volume_sandbox(
  db: Database,
  environment: RuntimeEnvironment,
  provider_environment_id: string,
) {
  const metadata = environment.environment_metadata;
  const volume_id = read_volume_id(metadata);
  const agent_workspace_path = read_agent_workspace_path(metadata);
  const workspace_layout_version = read_workspace_layout_version(metadata);
  return stop_e2b_sandbox({
    provider_sandbox_id: provider_environment_id,
    archil_root_path: read_volume_root_path(metadata),
    keep_for_resume: env.COWORKER_E2B_AUTO_PAUSE,
    reclaim_stuck_browser_state: await no_other_run_can_hold_browser_state(db, environment),
    ...(agent_workspace_path ? { agent_workspace_path } : {}),
    ...(workspace_layout_version ? { workspace_layout_version } : {}),
    ...(volume_id
      ? { browser_command_env: create_browser_state_config({ volume_id }).command_env }
      : {}),
  });
}

async function no_other_run_can_hold_browser_state(db: Database, environment: RuntimeEnvironment) {
  if (!environment.agent_id) return false;
  return !(await agent_has_live_run(db, {
    workspace_id: environment.workspace_id,
    agent_id: environment.agent_id,
  }));
}
