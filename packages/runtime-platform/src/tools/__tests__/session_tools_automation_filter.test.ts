import {
  build_session_tools_workspace,
  tool_data,
} from '@runtime-platform/tools/__tests__/session_tools_fixture';
import { list_sessions_tool } from '@runtime-platform/tools/definitions/sessions';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { beforeAll, describe, expect, it } from 'vitest';

type Workspace = Awaited<ReturnType<typeof build_session_tools_workspace>>;

let workspace: Workspace;

beforeAll(async () => {
  workspace = await build_session_tools_workspace();
}, 60_000);

function tool_context(): RuntimeToolExecutionContext {
  return {
    db: workspace.db,
    workspace_id: workspace.workspace_id,
    session_id: workspace.chat_session_id,
    run_id: workspace.chat_run_id,
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  };
}

describe('list_sessions with the automation filter', () => {
  it('filters by automation', async () => {
    const by_automation = tool_data(
      await list_sessions_tool.execute(
        { automation_id: workspace.automation_id, limit: 100 },
        tool_context(),
      ),
    );
    expect(
      (by_automation.sessions as { session_id: string }[]).map((row) => row.session_id),
    ).toEqual([workspace.automation_session_id]);
  });
});
