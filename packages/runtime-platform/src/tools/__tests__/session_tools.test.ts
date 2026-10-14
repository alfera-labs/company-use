import {
  build_session_tools_workspace,
  tool_data,
} from '@runtime-platform/tools/__tests__/session_tools_fixture';
import {
  list_active_runs_tool,
  list_sessions_tool,
  read_session_messages_tool,
  search_session_messages_tool,
} from '@runtime-platform/tools/definitions/sessions';
import {
  list_sessions_input_schema,
  read_session_messages_input_schema,
  search_session_messages_input_schema,
} from '@runtime-platform/tools/definitions/sessions_schemas';
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

describe('list_sessions', () => {
  it('lists the conversations the caller may read and hides the rest', async () => {
    const data = tool_data(await list_sessions_tool.execute({ limit: 100 }, tool_context()));
    const listed = (data.sessions as { session_id: string }[]).map((row) => row.session_id);

    expect(listed).toContain(workspace.chat_session_id);
    expect(listed).toContain(workspace.slack_session_id);
    expect(listed).toContain(workspace.automation_session_id);
    expect(listed).not.toContain(workspace.private_session_id);
    expect(listed).not.toContain(workspace.deleted_session_id);
  });

  it('says which conversation a run is working right now', async () => {
    const data = tool_data(await list_sessions_tool.execute({ limit: 100 }, tool_context()));
    const rows = data.sessions as { session_id: string; status: string; source: string }[];

    expect(rows.find((row) => row.session_id === workspace.automation_session_id)).toMatchObject({
      status: 'running',
      source: 'trigger',
    });
    expect(rows.find((row) => row.session_id === workspace.chat_session_id)).toMatchObject({
      status: 'idle',
    });
  });

  it('filters by channel and by when it last moved', async () => {
    const by_source = tool_data(
      await list_sessions_tool.execute({ source: 'slack', limit: 100 }, tool_context()),
    );
    expect((by_source.sessions as { session_id: string }[]).map((row) => row.session_id)).toEqual([
      workspace.slack_session_id,
    ]);

    const since_tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const by_time = tool_data(
      await list_sessions_tool.execute({ since: since_tomorrow, limit: 100 }, tool_context()),
    );
    expect(by_time).toMatchObject({ count: 0 });
  });

  it('caps the page it will hand back', () => {
    expect(list_sessions_input_schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(list_sessions_input_schema.parse({}).limit).toBe(25);
  });
});

describe('read_session_messages', () => {
  it('keeps the shape of a message instead of flattening it', async () => {
    const data = tool_data(
      await read_session_messages_tool.execute(
        { session_id: workspace.chat_session_id, limit: 20 },
        tool_context(),
      ),
    );
    const messages = data.messages as {
      role: string;
      text: string | null;
      tool_calls: { name: string; input_preview: string }[];
      files: { file_id: string | null; name: string | null }[];
      image_count: number;
    }[];

    expect(data).toMatchObject({ session_id: workspace.chat_session_id, source: 'dashboard' });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0]?.text).toContain('marble');
    expect(messages[1]?.tool_calls).toEqual([
      { tool_call_id: 'call_1', name: 'slack-send_message-1', input_preview: '{"channel":"#ops"}' },
    ]);
    expect(messages[1]?.files).toEqual([
      { file_id: 'fil_quote', name: 'quote.pdf', path: null, mime_type: 'application/pdf' },
    ]);
    expect(messages[1]?.image_count).toBe(1);
  });

  it('reads at most the asked-for window', async () => {
    const data = tool_data(
      await read_session_messages_tool.execute(
        { session_id: workspace.chat_session_id, limit: 1 },
        tool_context(),
      ),
    );
    expect(data).toMatchObject({ count: 1 });
    expect((data.messages as { role: string }[])[0]).toMatchObject({ role: 'assistant' });
    expect(
      read_session_messages_input_schema.safeParse({ session_id: 'ses', limit: 51 }).success,
    ).toBe(false);
  });

  it('refuses a conversation in a room the caller is not in', async () => {
    const result = await read_session_messages_tool.execute(
      { session_id: workspace.private_session_id, limit: 20 },
      tool_context(),
    );
    expect(result).toMatchObject({ success: false, error: { code: 'session_not_found' } });
  });
});

describe('search_session_messages', () => {
  it('finds the conversation a word was said in, and never one the caller may not read', async () => {
    const data = tool_data(
      await search_session_messages_tool.execute({ query: 'marble', limit: 20 }, tool_context()),
    );
    const matches = data.matches as { session_id: string; snippet: string }[];

    expect(matches.map((match) => match.session_id)).toContain(workspace.chat_session_id);
    expect(matches.map((match) => match.session_id)).not.toContain(workspace.private_session_id);
    expect(matches[0]?.snippet).toContain('marble');
  });

  it('narrows by channel and caps its results', async () => {
    const data = tool_data(
      await search_session_messages_tool.execute(
        { query: 'marble', source: 'slack', limit: 20 },
        tool_context(),
      ),
    );
    expect(data).toMatchObject({ count: 0 });
    expect(search_session_messages_input_schema.safeParse({ query: 'a', limit: 51 }).success).toBe(
      false,
    );
  });
});

describe('list_active_runs', () => {
  it('shows the runs going right now with the automation behind them', async () => {
    const data = tool_data(await list_active_runs_tool.execute({ limit: 100 }, tool_context()));
    const runs = data.runs as {
      run_id: string;
      session_id: string;
      automation_name: string | null;
    }[];

    expect(runs.find((run) => run.run_id === workspace.automation_run_id)).toMatchObject({
      session_id: workspace.automation_session_id,
      automation_name: 'Watch the vendor thread',
      run_status: 'queued',
    });
    expect(runs.map((run) => run.run_id)).not.toContain(workspace.private_run_id);
  });
});
