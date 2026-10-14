import { randomUUID } from 'node:crypto';
import { create_browser_session } from '@agent-core/browser/browser_session';
import type { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { agents, workspace_members, workspaces } from '@coworker/core/db/schema';
import {
  mark_coding_workspace_idle,
  type OpenedCodingWorkspace,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { eq } from 'drizzle-orm';

export type LiveFixture = Awaited<ReturnType<typeof bootstrap_default_workspace>>;

export async function bootstrap_live_test_workspace(
  db: Awaited<ReturnType<typeof create_test_database>>,
): Promise<LiveFixture> {
  const bootstrap = await bootstrap_default_workspace(db);
  const workspace_id = `ws_live_${randomUUID().replaceAll('-', '')}`;
  const actor_id = 'archil-live-test';
  await db
    .update(workspaces)
    .set({
      workspace_id,
      last_updated_time: new Date(),
      last_updated_by: actor_id,
    })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
  await db
    .update(workspace_members)
    .set({
      workspace_id,
      last_updated_time: new Date(),
      last_updated_by: actor_id,
    })
    .where(eq(workspace_members.workspace_id, bootstrap.workspace_id));
  await db
    .update(agents)
    .set({
      workspace_id,
      last_updated_time: new Date(),
      last_updated_by: actor_id,
    })
    .where(eq(agents.workspace_id, bootstrap.workspace_id));
  return { ...bootstrap, workspace_id };
}

export async function create_live_workspace(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: LiveFixture,
  label: string,
) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: `Archil live test ${label}`,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const workspace = await open_or_create_coding_workspace(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    run_id: run.run_id,
    provider: 'e2b',
    actor_id: bootstrap.user_id,
  }).catch((error) => {
    throw new Error(`Live workspace "${label}" did not open.`, { cause: error });
  });
  return { session, run, workspace };
}

export async function stop_live_workspace(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: LiveFixture,
  workspace: OpenedCodingWorkspace,
) {
  await mark_coding_workspace_idle(db, {
    workspace_id: bootstrap.workspace_id,
    runtime_environment_id: workspace.runtime_environment_id,
    close_token: workspace.close_token,
    actor_id: bootstrap.user_id,
  });
}

export async function save_browser_state(workspace: OpenedCodingWorkspace) {
  const browser = create_browser_session(workspace.environment, {
    default_command_timeout_ms: 90_000,
  });
  const opened = await browser.exec(['open', 'https://example.com']);
  if (opened.exit_code !== 0) {
    throw new Error(opened.stderr || opened.stdout || 'Browser state launch failed.');
  }
  const saved = await browser.exec([
    'eval',
    "localStorage.setItem('coworker_live_probe', 'persisted')",
  ]);
  if (saved.exit_code !== 0) {
    throw new Error(saved.stderr || saved.stdout || 'Browser state write failed.');
  }
}

export function provider_sandbox_id(workspace: OpenedCodingWorkspace) {
  const sandbox_id = workspace.environment.metadata?.provider_sandbox_id;
  if (typeof sandbox_id !== 'string' || !sandbox_id) {
    throw new Error('Live E2B workspace did not expose a provider sandbox id.');
  }
  return sandbox_id;
}
