import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { read_approval_calls } from '@coworker/core/access/tool_policy_approval_schema';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { set_policy } from '@coworker/core/db/queries/policies';
import {
  create_run,
  create_run_message,
  create_session,
  get_tool_call,
  list_run_chat_events,
} from '@coworker/core/db/queries/sessions';
import { open_workspace_project } from '@coworker/core/db/queries/workspace_projects';
import { users, workspace_members } from '@coworker/core/db/schema';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import { run_decided_tool_calls } from '@runtime-platform/events/policy_decision_replay';
import { build_session_context } from '@runtime-platform/orchestrator/context_builder';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspace_to_open = vi.hoisted(() => ({ base_path: '', refuses_to_open: false }));

vi.mock('@runtime-platform/orchestrator/workspace_runtime', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/orchestrator/workspace_runtime')>();
  return {
    ...actual,
    open_or_create_coding_workspace: (
      db: Parameters<typeof actual.open_or_create_coding_workspace>[0],
      input: Parameters<typeof actual.open_or_create_coding_workspace>[1],
    ) => {
      if (workspace_to_open.refuses_to_open) throw new Error('that sandbox is gone');
      return actual.open_or_create_coding_workspace(db, {
        ...input,
        provider: 'local',
        workspace_base_path: workspace_to_open.base_path,
      });
    },
  };
});

beforeEach(async () => {
  workspace_to_open.base_path = await mkdtemp(path.join(tmpdir(), 'coworker-replay-'));
  workspace_to_open.refuses_to_open = false;
});

afterEach(() => rm(workspace_to_open.base_path, { recursive: true, force: true }));

describe('catching up a decided step', () => {
  it('runs the approved call itself, in the row it was asked about', async () => {
    const asked = await ask_about_a_math_step();

    const outcomes = await catch_up(asked, 'approved');

    expect(outcomes).toMatchObject([{ tool_name: 'math-calculate-1', outcome: 'ran' }]);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('completed');
    expect(tool_call?.input_data).toEqual({ expression: '2 + 2', decimal_places: 40 });
    expect(JSON.stringify(tool_call?.output_data)).toContain('4');
  });

  it('does nothing the second time the same answer arrives', async () => {
    const asked = await ask_about_a_math_step();
    await catch_up(asked, 'approved');
    const after_first = await read_the_tool_call(asked);

    await catch_up(asked, 'approved');

    const after_second = await read_the_tool_call(asked);
    expect(after_second?.completed_time).toEqual(after_first?.completed_time);
    expect(after_second?.output_data).toEqual(after_first?.output_data);
  });

  it('records a refusal as a refusal, not as a failure', async () => {
    const asked = await ask_about_a_math_step();

    const outcomes = await catch_up(asked, 'denied');

    expect(outcomes).toMatchObject([{ outcome: 'refused' }]);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('denied');
    expect(tool_call?.error_code).toBe('refused_by_person');
  });

  it('runs the calls nobody was asked about too', async () => {
    const asked = await ask_about_a_math_step([
      { tool_call_id: 'call_2', tool_name: 'runtime-load_skill-1', input: { skill_slug: 'notes' } },
    ]);
    expect(asked.calls.map((call) => call.needs_a_person)).toEqual([true, false]);

    const outcomes = await catch_up(asked, 'approved');

    expect(outcomes).toHaveLength(2);
    const statuses = await Promise.all(
      asked.calls.map(
        async (call) =>
          (await get_tool_call(asked.db, asked.actor.workspace_id, call.tool_call_id))?.tool_status,
      ),
    );
    expect(statuses).not.toContain('awaiting_approval');
  });

  it('will not run a call whose input changed after it was approved', async () => {
    const asked = await ask_about_a_math_step();
    const tampered = asked.calls.map((call) => ({ ...call, input_sha256: 'a'.repeat(64) }));

    const outcomes = await catch_up({ ...asked, calls: tampered }, 'approved');

    expect(outcomes).toMatchObject([{ outcome: 'could_not_run' }]);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('failed');
    expect(tool_call?.error_code).toBe('input_changed_since_approval');
  });

  it('leaves the run that picks the step back up reading the real result', async () => {
    const asked = await ask_about_a_math_step();

    await catch_up(asked, 'approved');

    const result = await read_the_tool_result_the_model_reads(asked);
    expect(result?.text).toContain('4');
    expect(JSON.stringify(result)).not.toContain('Waiting for a person');
  });

  it('runs a call the run owned itself, with the tools that run had', async () => {
    const asked = await ask_about_a_file_write();

    const outcomes = await catch_up(asked, 'approved');

    expect(outcomes).toMatchObject([{ tool_name: 'workspace-write_file', outcome: 'ran' }]);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('completed');
    expect(tool_call?.error_code).toBeNull();
  });

  it('announces the held call once and publishes the result it finished with', async () => {
    const asked = await ask_about_a_math_step();

    await catch_up(asked, 'approved');

    const tool_call_id = asked.calls[0]?.tool_call_id;
    const chat = await read_chat_events_for_the_call(asked, tool_call_id ?? '');
    expect(chat.map((event) => [event.event_label, event.item.tool_status])).toEqual([
      ['item_started', 'awaiting_approval'],
      ['item_completed', 'completed'],
    ]);
    expect(JSON.stringify(chat.at(1)?.item.output_text)).toContain('4');
  });

  it('tells the model why the person said no', async () => {
    const asked = await ask_about_a_math_step();

    await catch_up(asked, 'denied', 'do that in dollars, not euros');

    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.output_text).toContain('do that in dollars, not euros');
    expect(tool_call?.error_code).toBe('refused_by_person');
  });

  it('leaves the run that picks the step back up reading the refusal', async () => {
    const asked = await ask_about_a_math_step();

    await catch_up(asked, 'denied', 'not now');

    const result = await read_the_tool_result_the_model_reads(asked);
    expect(result?.text).toContain('A person said no to this');
    expect(result?.text).toContain('not now');
    expect(JSON.stringify(result)).not.toContain('Waiting for a person');
  });

  it('announces the refusal on the timeline the held call was announced on', async () => {
    const asked = await ask_about_a_math_step();

    await catch_up(asked, 'denied', 'not now');

    const chat = await read_chat_events_for_the_call(asked, asked.calls[0]?.tool_call_id ?? '');
    expect(chat.map((event) => [event.event_label, event.item.tool_status])).toEqual([
      ['item_started', 'awaiting_approval'],
      ['item_completed', 'denied'],
    ]);
    expect(chat.at(1)?.item.output_text).toContain('not now');
  });

  it('leaves the model reading why an approved call could not run', async () => {
    const asked = await ask_about_a_file_write();
    workspace_to_open.refuses_to_open = true;

    await catch_up(asked, 'approved');

    const result = await read_the_tool_result_the_model_reads(asked);
    expect(result?.text).toContain('could not be replayed');
    expect(JSON.stringify(result)).not.toContain('Waiting for a person');
  });

  it('announces a call the run owned itself once, however it was resumed', async () => {
    const asked = await ask_about_a_file_write();

    await catch_up(asked, 'approved');

    const chat = await read_chat_events_for_the_call(asked, asked.calls[0]?.tool_call_id ?? '');
    expect(chat.map((event) => [event.event_label, event.item.tool_status])).toEqual([
      ['item_started', 'awaiting_approval'],
      ['item_completed', 'completed'],
    ]);
  });

  it('says the approval could not be replayed when that run cannot be opened again', async () => {
    const asked = await ask_about_a_file_write();
    workspace_to_open.refuses_to_open = true;

    const outcomes = await catch_up(asked, 'approved');

    expect(outcomes).toMatchObject([{ outcome: 'could_not_run', reason: /that sandbox is gone/ }]);
    const tool_call = await read_the_tool_call(asked);
    expect(tool_call?.tool_status).toBe('failed');
    expect(tool_call?.error_code).toBe('run_tool_unavailable');
    expect(tool_call?.error_message).toContain('could not be replayed');
  });
});

describe('catching up a decided step of a chat', () => {
  it.each([
    ['a workspace project', 'workspace', 1, 'system/tool-output'],
    ['a private project in a one-member workspace', 'private', 1, 'system/tool-output'],
    ['a private project in a two-member workspace', 'private', 2, 'tmp/tool-output'],
  ] as const)('saves the long output of %s where that chat writes', async (_name, access, members, folder) => {
    const asked = await ask_about_a_long_command(access, members);

    const outcomes = await catch_up(asked, 'approved');

    expect(outcomes).toMatchObject([{ tool_name: 'workspace-run_command', outcome: 'ran' }]);
    const saved = await list_saved_tool_outputs();
    expect(saved).toEqual([expect.stringContaining(`${folder}/`)]);
  });
});

async function list_saved_tool_outputs() {
  const entries = await readdir(workspace_to_open.base_path, { recursive: true });
  return entries.map(String).filter((entry) => /tool-output\/.+\.txt$/u.test(entry));
}

function ask_about_a_long_command(project_access: 'workspace' | 'private', member_count: number) {
  return ask_about_a_step({
    member_count,
    rule: { resource_type: 'node', resource_id: 'workspace-run_command' },
    calls: [
      {
        tool_call_id: 'call_1',
        tool_name: 'workspace-run_command',
        input: { command: "head -c 20000 /dev/zero | tr '\\0' x" },
      },
    ],
    project_access,
  });
}

async function add_members(db: Database, workspace_id: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    const [user] = await db
      .insert(users)
      .values({
        email: `zq-test-member-${index}@example.test`,
        created_by: 'system:test',
        last_updated_by: 'system:test',
      })
      .returning();
    if (!user) throw new Error('member seed failed');
    await db.insert(workspace_members).values({
      workspace_member_id: `wsm_${user.user_id}`,
      workspace_id,
      user_id: user.user_id,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });
  }
}

const open_project_by_access = {
  workspace: open_workspace_project,
  private: open_personal_project,
};

type AskedStep = Awaited<ReturnType<typeof ask_about_a_step>>;

type StepCall = { tool_call_id: string; tool_name: string; input: unknown };

function ask_about_a_math_step(riders: StepCall[] = []) {
  return ask_about_a_step({
    rule: { resource_type: 'node', resource_id: 'math-calculate-1' },
    calls: [
      { tool_call_id: 'call_1', tool_name: 'math-calculate-1', input: { expression: '2 + 2' } },
      ...riders,
    ],
  });
}

function ask_about_a_file_write() {
  return ask_about_a_step({
    rule: { resource_type: 'node_label', resource_id: 'changes_things' },
    calls: [
      {
        tool_call_id: 'call_1',
        tool_name: 'workspace-write_file',
        input: { path: 'files/notes.md', content: 'hello' },
      },
    ],
  });
}

async function ask_about_a_step(step: {
  rule: { resource_type: 'node' | 'node_label'; resource_id: string };
  calls: StepCall[];
  project_access?: 'workspace' | 'private';
  member_count?: number;
}) {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await add_members(db, actor.workspace_id, (step.member_count ?? 1) - 1);
  await seed_runtime_tool_catalog(db);
  const project = step.project_access
    ? await open_project_by_access[step.project_access](db, {
        workspace_id: actor.workspace_id,
        user_id: actor.user_id,
      })
    : null;
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    ...(project ? { project_id: project.project_id } : {}),
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  await set_policy(db, {
    workspace_id: actor.workspace_id,
    ...step.rule,
    scope_type: 'workspace',
    scope_id: actor.workspace_id,
    policy_mode: 'ask',
    actor_id: actor.user_id,
  });
  await create_run_message(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'assistant',
    message_content: {
      type: 'multimodal',
      parts: step.calls.map((call) => ({
        type: 'tool_call' as const,
        id: call.tool_call_id,
        name: call.tool_name,
        arguments: call.input as Record<string, unknown>,
      })),
    },
    source_type: 'runtime',
    actor_id: actor.user_id,
  });

  const policy = create_tool_batch_policy(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: actor.agent_id,
    emit_chat_stream_event_drafts: async (drafts) => {
      await record_chat_stream_event_drafts(db, {
        workspace_id: actor.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        drafts,
        actor_id: actor.user_id,
      });
    },
    actor_id: actor.user_id,
  });
  policy.set_run_tools(
    create_runtime_tool_definitions(db, {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      agent_id: actor.agent_id,
      actor_id: actor.user_id,
    }),
  );
  const decision = await policy.decide(step.calls);
  expect(decision.kind).toBe('needs_approval');

  const [wait] = await list_tool_policy_waits(db, {
    workspace_id: actor.workspace_id,
    status: 'waiting',
  });
  if (!wait?.metadata.policy_approval) throw new Error('The step recorded no approval request.');
  return {
    db,
    actor,
    session,
    run,
    job_id: wait.job_id,
    calls: read_approval_calls(wait.metadata.policy_approval),
  };
}

function catch_up(asked: AskedStep, decision: 'approved' | 'denied', reason?: string) {
  return run_decided_tool_calls(asked.db, {
    workspace_id: asked.actor.workspace_id,
    session_id: asked.session.session_id,
    run_id: asked.run.run_id,
    job_id: asked.job_id,
    decision,
    ...(reason === undefined ? {} : { reason }),
    decision_event_id: 'evt_decision_1',
    calls: asked.calls,
    actor_id: asked.actor.user_id,
  });
}

async function read_chat_events_for_the_call(asked: AskedStep, tool_call_id: string) {
  const rows = await list_run_chat_events(asked.db, asked.actor.workspace_id, asked.run.run_id, {});
  return rows
    .map(
      (row) =>
        row.event_data as {
          item?: { tool_call_id?: string; tool_status?: string; output_text?: string };
        },
    )
    .map((data, index) => ({ event_label: rows[index]?.event_label, item: data.item ?? {} }))
    .filter((event) => event.item.tool_call_id === tool_call_id);
}

function read_the_tool_call(asked: AskedStep) {
  const tool_call_id = asked.calls[0]?.tool_call_id;
  if (!tool_call_id) throw new Error('The step recorded no call.');
  return get_tool_call(asked.db, asked.actor.workspace_id, tool_call_id);
}

async function read_the_tool_result_the_model_reads(asked: AskedStep) {
  const context = await build_session_context(asked.db, {
    workspace_id: asked.actor.workspace_id,
    session_id: asked.session.session_id,
    system_instructions: 'Catching the step back up.',
  });
  return context.messages.find((message) =>
    (message.content.parts ?? []).some(
      (part) => part.type === 'tool_result' && part.tool_call_id === 'call_1',
    ),
  )?.content;
}
