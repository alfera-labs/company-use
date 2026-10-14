import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('open_or_create_coding_workspace preview persistence', () => {
  it('keeps active_previews from an earlier run when the workspace is reopened', async () => {
    const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
    const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
    const { create_session, get_runtime_environment, update_runtime_environment_state } =
      await import('@coworker/core/db/queries/sessions');
    const { open_or_create_coding_workspace } = await import(
      '@runtime-platform/orchestrator/workspace_runtime'
    );

    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Preview persistence test',
      actor_id: bootstrap.user_id,
    });
    const workspace_base_path = path.join(
      os.tmpdir(),
      `coworker-preview-persistence-${session.session_id}`,
    );
    const open_input = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      run_id: 'run_first',
      actor_id: bootstrap.user_id,
      provider: 'local' as const,
      workspace_base_path,
    };

    const first = await open_or_create_coding_workspace(db, open_input);
    await update_runtime_environment_state(db, {
      runtime_environment_id: first.runtime_environment_id,
      environment_status: 'running',
      merge_environment_metadata: {
        active_preview_ports: [3000],
        active_previews: { '3000': { port: 3000, launch_command: 'python3' } },
      },
      actor_id: bootstrap.user_id,
    });

    await open_or_create_coding_workspace(db, { ...open_input, run_id: 'run_second' });

    const reopened = await get_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: first.runtime_environment_id,
    });
    expect(reopened?.environment_metadata).toMatchObject({
      active_previews: { '3000': { port: 3000 } },
    });
  });
});
