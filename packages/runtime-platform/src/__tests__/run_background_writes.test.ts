import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  get_tool_call,
  list_run_events,
  list_run_messages,
} from '@coworker/core/db/queries/sessions';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  defer_run_write,
  open_run_background_writes,
  settle_run_background_writes,
} from '@runtime-platform/tools/run_background_writes';
import {
  create_logged_tool_definition,
  execute_runtime_tool,
} from '@runtime-platform/tools/tool_execution_service';
import { afterEach, describe, expect, it, vi } from 'vitest';

const gates = vi.hoisted(() => ({
  finish: Promise.resolve() as Promise<void>,
  fail_next_result_message: false,
}));

vi.mock('@coworker/core/db/queries/sessions', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/core/db/queries/sessions')>();
  return {
    ...actual,
    update_tool_call_finished: async (
      ...args: Parameters<typeof actual.update_tool_call_finished>
    ) => {
      await gates.finish;
      return actual.update_tool_call_finished(...args);
    },
    create_run_message: async (...args: Parameters<typeof actual.create_run_message>) => {
      if (gates.fail_next_result_message) {
        gates.fail_next_result_message = false;
        throw new Error('pooler dropped the result message');
      }
      return actual.create_run_message(...args);
    },
  };
});

afterEach(() => {
  gates.finish = Promise.resolve();
  gates.fail_next_result_message = false;
  vi.restoreAllMocks();
});

describe('run background writes', () => {
  it('runs deferred work now and settle waits for all of it', async () => {
    open_run_background_writes('run_a');
    const finished: string[] = [];
    const slow = open_gate();
    expect(
      await defer_run_write('run_a', 'one', () => slow.promise.then(() => finished.push('one'))),
    ).toBeUndefined();
    await defer_run_write('run_a', 'two', async () => finished.push('two'));

    let settled = false;
    const settling = settle_run_background_writes('run_a').then(() => {
      settled = true;
    });
    await tick();
    expect(finished).toEqual(['two']);
    expect(settled).toBe(false);

    slow.release();
    await settling;
    expect(finished).toEqual(['two', 'one']);
  });

  it('runs writes that share a label one after another', async () => {
    open_run_background_writes('run_b');
    const order: string[] = [];
    const first = open_gate();
    await defer_run_write('run_b', 'log', () => first.promise.then(() => order.push('first')));
    await defer_run_write('run_b', 'log', async () => order.push('second'));
    await tick();
    expect(order).toEqual([]);
    first.release();
    await settle_run_background_writes('run_b');
    expect(order).toEqual(['first', 'second']);
  });

  it('logs a failed write, keeps it from the caller, and keeps its queue going', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    open_run_background_writes('run_c');
    const after: string[] = [];
    await defer_run_write('run_c', 'log', () => Promise.reject(new Error('insert failed')));
    await defer_run_write('run_c', 'log', async () => after.push('ran'));
    await expect(settle_run_background_writes('run_c')).resolves.toBeUndefined();
    expect(after).toEqual(['ran']);
    expect(JSON.stringify(logged.mock.calls)).toContain('insert failed');
  });

  it('runs a write in place, with its value, for a run that never opened', async () => {
    expect(await defer_run_write('run_unopened', 'x', async () => 42)).toBe(42);
    await expect(settle_run_background_writes('run_unopened')).resolves.toBeUndefined();
    await expect(settle_run_background_writes('run_unopened')).resolves.toBeUndefined();
  });
});

describe('tool bookkeeping behind the model', () => {
  it('returns a workspace tool result before the finish write, and settle completes it', async () => {
    const fixture = await create_fixture();
    const finish = open_gate();
    gates.finish = finish.promise;
    open_run_background_writes(fixture.run_id);

    const result = await echo_tool(fixture).execute?.({ text: 'hi' }, fixture.context);

    expect(result).toMatchObject({ ok: true, content_text: 'hi' });
    const tool_call_id = String(result?.metadata?.tool_call_id);
    expect(await tool_result_messages(fixture)).toHaveLength(1);
    expect((await get_tool_call(fixture.db, fixture.workspace_id, tool_call_id))?.tool_status).toBe(
      'executing',
    );

    finish.release();
    await settle_run_background_writes(fixture.run_id);
    const finished = await get_tool_call(fixture.db, fixture.workspace_id, tool_call_id);
    expect(finished?.tool_status).toBe('completed');
    expect(await event_labels(fixture, tool_call_id)).toContain('tool_call.completed');
    expect(await tool_call_usage_count(fixture)).toBe(1);
  });

  it('finishes the row in place for a caller outside a run loop', async () => {
    const fixture = await create_fixture();

    const result = await echo_tool(fixture).execute?.({ text: 'hi' }, fixture.context);

    const tool_call_id = String(result?.metadata?.tool_call_id);
    expect((await get_tool_call(fixture.db, fixture.workspace_id, tool_call_id))?.tool_status).toBe(
      'completed',
    );
  });

  it('returns a catalog tool result before the finish write, and settle completes it', async () => {
    const fixture = await create_fixture();
    const finish = open_gate();
    gates.finish = finish.promise;
    open_run_background_writes(fixture.run_id);

    const execution = await execute_runtime_tool(fixture.db, math_call(fixture));

    expect(execution.result.success).toBe(true);
    expect(execution.tool_call.tool_status).toBe('executing');
    expect(await tool_result_messages(fixture)).toHaveLength(1);

    finish.release();
    await settle_run_background_writes(fixture.run_id);
    const finished = await get_tool_call(
      fixture.db,
      fixture.workspace_id,
      execution.tool_call.tool_call_id,
    );
    expect(finished?.tool_status).toBe('completed');
    expect(await event_labels(fixture, execution.tool_call.tool_call_id)).toContain(
      'tool_call.completed',
    );
  });

  it('still finishes a catalog row whose result message failed to save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await create_fixture();
    gates.fail_next_result_message = true;
    open_run_background_writes(fixture.run_id);

    const execution = await execute_runtime_tool(fixture.db, math_call(fixture));
    await settle_run_background_writes(fixture.run_id);

    expect(execution.result.success).toBe(true);
    expect(await tool_result_messages(fixture)).toHaveLength(0);
    const finished = await get_tool_call(
      fixture.db,
      fixture.workspace_id,
      execution.tool_call.tool_call_id,
    );
    expect(finished?.tool_status).toBe('completed');
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  return {
    db,
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
    context: { run_key: run.run_id, session_key: session.session_id, metadata: {} },
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function echo_tool(fixture: Fixture) {
  return create_logged_tool_definition(
    fixture.db,
    {
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      run_id: fixture.run_id,
      agent_id: fixture.agent_id,
      actor_id: fixture.actor_id,
    },
    {
      tool_name: 'workspace-echo',
      description: 'Echoes its text.',
      execute: async (input) => ({
        ok: true,
        content_text: String((input as { text: string }).text),
        content_json: input,
      }),
    },
    {
      timeout_ms: 5_000,
      output_limit_bytes: 16_000,
      risk_class: 'read',
      approval_mode: 'auto',
      sandbox_required: false,
    },
  );
}

function math_call(fixture: Fixture) {
  return {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.actor_id,
    model_tool_call_id: 'model_call_1',
    node_key: 'math-calculate-1',
    tool_input: { expression: '2 + 2' },
  };
}

async function tool_result_messages(fixture: Fixture) {
  const messages = await list_run_messages(fixture.db, fixture.workspace_id, fixture.run_id);
  return messages.filter((message) => message.message_role === 'tool_result');
}

async function event_labels(fixture: Fixture, tool_call_id: string) {
  const events = await list_run_events(fixture.db, fixture.workspace_id, fixture.run_id, {
    tool_call_id,
  });
  return events.map((event) => event.event_label);
}

async function tool_call_usage_count(fixture: Fixture) {
  const records = await fixture.db.query.usage_records.findMany({
    where: (usage, { and, eq }) =>
      and(eq(usage.run_id, fixture.run_id), eq(usage.usage_kind, 'tool_call')),
  });
  return records.length;
}

function open_gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
