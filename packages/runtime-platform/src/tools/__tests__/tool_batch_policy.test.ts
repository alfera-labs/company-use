import { browser_tool_name } from '@agent-core/browser/browser_tool';
import type { RuntimeToolDefinition } from '@agent-core/tools/runtime_tool';
import { event_jobs, nodes } from '@coworker/core';
import { tool_policy_awaiting_approval_event_label } from '@coworker/core/access/tool_policy_approval_schema';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  list_tool_policy_waits,
  withdraw_run_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import { find_run_wait } from '@coworker/core/db/queries/run_suspension';
import { add_session_approval_grants } from '@coworker/core/db/queries/session_approval_grants';
import {
  type CreateSessionInput,
  create_run,
  create_session,
  list_run_chat_events,
  list_run_events,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import { agent_heartbeat_actor } from '@coworker/shared';
import { record_chat_stream_event_drafts } from '@runtime-platform/chat_stream/chat_stream_events';
import {
  type BrowserToolAssemblyInput,
  create_browser_tool_definitions,
} from '@runtime-platform/tools/browser_harness';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { record_the_answer } from '@runtime-platform/tools/policies/answer_from_the_person';
import { read_tool_approval_view } from '@runtime-platform/tools/policies/approval_reader_service';
import { build_approval_card } from '@runtime-platform/tools/policies/approval_slack_cards';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import { approval_wait_window_ms_for_session } from '@runtime-platform/tools/policies/wait_for_the_person';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('deciding a whole tool batch', () => {
  it('runs a step where nothing needs a person', async () => {
    const fixture = await create_fixture();

    expect((await decide(fixture, [math_call('call_1', '2 + 2')])).kind).toBe('run');
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('holds every call in a step when one of them needs a person', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);

    const decision = await decide(fixture, [
      math_call('call_1', '2 + 2'),
      transport_call('call_2', 'math-calculate-1', { expression: '3 + 3' }),
    ]);

    expect(decision.kind).toBe('needs_approval');

    const tool_calls = await list_run_tool_calls(
      fixture.db,
      fixture.actor.workspace_id,
      fixture.run.run_id,
    );
    expect(tool_calls).toHaveLength(2);
    expect(tool_calls.map((call) => call.tool_status)).toEqual([
      'awaiting_approval',
      'awaiting_approval',
    ]);
    expect(tool_calls.map((call) => call.tool_name)).toEqual([
      'math-calculate-1',
      'math-calculate-1',
    ]);

    const waits = await list_waits(fixture);
    expect(waits).toHaveLength(1);
    const wait = waits[0]?.metadata.policy_approval;
    expect(wait).toMatchObject({ version: 2, eligible_user_ids: [fixture.actor.user_id] });
    expect(wait && 'calls' in wait ? wait.calls : []).toHaveLength(2);

    const run_wait = await find_run_wait(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      run_id: fixture.run.run_id,
    });
    expect(run_wait?.job_id).toBe(waits[0]?.job_id);
  });

  it('asks the same step once, however many times the model retries it', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const calls = [math_call('call_1', '2 + 2')];

    await decide(fixture, calls);
    await decide(fixture, [math_call('call_2', '2 + 2')]);

    expect(await list_waits(fixture)).toHaveLength(1);
  });

  it('withdraws the question when the run that asked is stopped', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    await decide(fixture, [math_call('call_1', '2 + 2')]);
    expect(await list_waits(fixture)).toHaveLength(1);

    await withdraw_run_tool_policy_waits(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      run_id: fixture.run.run_id,
      actor_id: fixture.actor.user_id,
    });

    expect(await list_waits(fixture)).toEqual([]);
    const [held] = await list_run_tool_calls(
      fixture.db,
      fixture.actor.workspace_id,
      fixture.run.run_id,
    );
    expect(held?.tool_status).toBe('cancelled');
  });

  it('withdraws the older question when a newer run asks the same step again', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    await decide(fixture, [math_call('call_1', '2 + 2')]);
    const [asked_first] = await list_waits(fixture);

    const asking_again = await create_run(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.actor.agent_id,
      trigger_type: 'user_message',
      actor_id: fixture.actor.user_id,
    });
    const policy = create_tool_batch_policy(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      run_id: asking_again.run_id,
      agent_id: fixture.actor.agent_id,
      actor_id: fixture.actor.user_id,
    });
    policy.set_run_tools(run_tools(fixture));
    await policy.decide([math_call('call_2', '2 + 2')]);

    const waiting = await list_waits(fixture);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.job_id).not.toBe(asked_first?.job_id);

    const withdrawn = await fixture.db.query.event_jobs.findFirst({
      where: eq(event_jobs.job_id, asked_first?.job_id ?? ''),
    });
    expect(withdrawn?.job_status).toBe('done');
    expect((withdrawn?.result_data as { withdrawn?: string })?.withdrawn).toBe('superseded');
    const [held] = await list_run_tool_calls(
      fixture.db,
      fixture.actor.workspace_id,
      fixture.run.run_id,
    );
    expect(held?.tool_status).toBe('cancelled');
  });

  it('writes the pause into the run log, once, naming the question and every call it holds', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);

    await decide(fixture, [
      math_call('call_1', '2 + 2'),
      transport_call('call_2', 'math-calculate-1', { expression: '3 + 3' }),
    ]);
    await decide(fixture, [
      math_call('call_3', '2 + 2'),
      transport_call('call_4', 'math-calculate-1', { expression: '3 + 3' }),
    ]);

    const paused = await read_pause_rows(fixture);
    expect(paused).toHaveLength(1);
    const [wait] = await list_waits(fixture);
    const held = (await list_calls(fixture)).slice(0, 2).map((call) => call.tool_call_id);
    expect(paused[0]?.event_data).toEqual({
      approval_request_id: wait?.job_id,
      tool_call_ids: held,
    });
    const asked_at = (await read_run_events(fixture))
      .filter((row) => row.tool_call_id && held.includes(row.tool_call_id))
      .map((row) => row.event_sequence);
    expect(Math.max(...asked_at)).toBeLessThan(paused[0]?.event_sequence ?? 0);
  });

  it('parks an API session at once and keeps the window for everybody else', async () => {
    expect(approval_wait_window_ms_for_session('api')).toBe(0);
    expect(approval_wait_window_ms_for_session('dashboard')).toBeGreaterThan(60_000);
    expect(approval_wait_window_ms_for_session('slack')).toBeGreaterThan(60_000);

    const fixture = await create_fixture({ session_source: 'api' });
    await ask_before_math(fixture);
    const asked = await decide(fixture, [math_call('call_1', '2 + 2')]);
    if (asked.kind !== 'needs_approval') throw new Error('Expected the step to ask.');

    const started = Date.now();
    const answer = await asked.wait_for_answer();

    expect(answer).toMatchObject({ answer: 'unanswered' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('tells the model why the person said no', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const policy = create_policy(fixture);

    const refusal = await answer(
      fixture,
      policy,
      [math_call('call_1', '2 + 2')],
      'denied',
      'use the staging account instead',
    );

    expect(refusal).toMatchObject({ answer: 'refused' });
    expect(refusal && 'message' in refusal ? refusal.message : '').toContain(
      'use the staging account instead',
    );
    const [refused] = await list_calls(fixture);
    expect(refused?.output_text).toContain('use the staging account instead');
  });

  it('refuses instead of holding when nobody can decide', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);

    const decision = await decide(fixture, [math_call('call_1', '2 + 2')], agent_heartbeat_actor);

    expect(decision.kind).toBe('needs_approval');
    const answer = decision.kind === 'needs_approval' ? await decision.wait_for_answer() : null;
    expect(answer).toMatchObject({ answer: 'refused' });
    expect(await list_waits(fixture)).toEqual([]);
    expect(
      await list_run_tool_calls(fixture.db, fixture.actor.workspace_id, fixture.run.run_id),
    ).toEqual([]);
  });
});

describe('a tool the catalog never had', () => {
  it('holds a browser call when the workspace asks before every tool', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [browser_call('call_1')]);

    expect(decision.kind).toBe('needs_approval');
    expect((await list_calls(fixture)).map((call) => [call.tool_name, call.tool_status])).toEqual([
      [browser_tool_name, 'awaiting_approval'],
    ]);
  });

  it('holds a coding tool that writes files, and says it changes things', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [write_file_call('call_1')]);

    expect(decision.kind).toBe('needs_approval');
    const [held] = await list_calls(fixture);
    expect(held?.tool_name).toBe('workspace-write_file');
    expect(held?.tool_call_metadata?.approval_labels).toContain('changes_things');
  });

  it('takes each tool at its own word, so a rule about changing things leaves a read alone', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'changes_things');

    expect((await decide(fixture, [write_file_call('call_1')])).kind).toBe('needs_approval');
    expect(await decide(fixture, [grep_call('call_2')])).toEqual({ kind: 'run' });
  });

  it('refuses a turn that names a tool this run does not have', async () => {
    const fixture = await create_fixture();

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: 'shell_out-1', input: {} },
    ]);

    expect(decision.kind).toBe('needs_approval');
    const answer =
      decision.kind === 'needs_approval' ? await decision.wait_for_answer() : undefined;
    expect(answer).toMatchObject({ answer: 'refused' });
    expect(answer && 'message' in answer ? answer.message : '').toContain('shell_out-1');
    expect(await list_waits(fixture)).toEqual([]);
    expect(await list_calls(fixture)).toEqual([]);
  });

  it('leaves the same step untouched when the workspace has no policies at all', async () => {
    const fixture = await create_fixture();

    const decision = await decide(fixture, [
      browser_call('call_1'),
      write_file_call('call_2'),
      math_call('call_3', '2 + 2'),
    ]);

    expect(decision).toEqual({ kind: 'run' });
    expect(await list_calls(fixture)).toEqual([]);
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('never asks about a tool that declares itself exempt', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: exempt_run_tool.tool_name, input: {} },
    ]);

    expect(decision).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
  });
});

describe('the plumbing a rule about every tool is not about', () => {
  it('never asks before a tool loads a skill or reads what it already knows', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: 'runtime-load_skill-1', input: { skill_slug: 'notes' } },
      {
        tool_call_id: 'call_2',
        tool_name: 'runtime-search_context-1',
        input: { query: 'who is who' },
      },
    ]);

    expect(decision).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
    expect(await list_calls(fixture)).toEqual([]);
  });

  it('never asks before the agent answers in the thread it was addressed in', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: 'slack-respond-1', input: { text: 'On my way.' } },
    ]);

    expect(decision).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('still asks before the same rule reaches the outside world', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [
      {
        tool_call_id: 'call_1',
        tool_name: 'runtime-web_search-1',
        input: { query: 'opening times' },
      },
      {
        tool_call_id: 'call_2',
        tool_name: 'slack-send_message-1',
        input: { channel_id: 'C1', text: 'hello' },
      },
    ]);

    expect(decision.kind).toBe('needs_approval');
    const wait = (await list_waits(fixture))[0]?.metadata.policy_approval;
    const calls = wait && 'calls' in wait ? wait.calls : [];
    expect(calls.map((call) => call.needs_a_person)).toEqual([true, true]);
  });

  it('honours the exemption the code declares even when the stored catalog row predates it', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    await forget_the_exemption_in_the_catalog(fixture, 'runtime-load_skill-1');

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: 'runtime-load_skill-1', input: { skill_slug: 'notes' } },
    ]);

    expect(decision).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('holds the exempt calls with the step but asks about none of them', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    const decision = await decide(fixture, [
      { tool_call_id: 'call_1', tool_name: 'runtime-load_skill-1', input: { skill_slug: 'notes' } },
      { tool_call_id: 'call_2', tool_name: 'runtime-load_skill-1', input: { skill_slug: 'rates' } },
      {
        tool_call_id: 'call_3',
        tool_name: 'runtime-web_search-1',
        input: { query: 'opening times' },
      },
    ]);

    expect(decision.kind).toBe('needs_approval');
    expect((await list_calls(fixture)).map((call) => call.tool_name)).toEqual([
      'runtime-load_skill-1',
      'runtime-load_skill-1',
      'runtime-web_search-1',
    ]);
    const wait = (await list_waits(fixture))[0]?.metadata.policy_approval;
    const calls = wait && 'calls' in wait ? wait.calls : [];
    expect(calls.map((call) => call.needs_a_person)).toEqual([false, false, true]);

    const view = await read_tool_approval_view(
      fixture.db,
      fixture.actor.workspace_id,
      (await list_waits(fixture))[0] as never,
    );
    expect(view?.calls.map((call) => call.node_key)).toEqual(['runtime-web_search-1']);
    expect(build_approval_card(view as never).blocks).not.toContainEqual(
      expect.objectContaining({
        text: expect.objectContaining({ text: expect.stringContaining('Skill slug') }),
      }),
    );
  });

  it('seeds the exemption into the catalog too, so both sources agree', async () => {
    const fixture = await create_fixture();

    const node = await fixture.db.query.nodes.findFirst({
      where: (table, { eq }) => eq(table.node_key, 'runtime-load_skill-1'),
    });

    expect(node?.metadata).toMatchObject({ policy_exempt: true });
  });
});

describe('an answer that carries through the run', () => {
  it('stops asking about a tool this run was already told yes about', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    const policy = create_policy(fixture);

    await approve(fixture, policy, [search_call('call_1', 'opening times')]);

    expect(await policy.decide([search_call('call_2', 'closing times')])).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('runs the call it stopped asking about', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const policy = create_policy(fixture);
    await approve(fixture, policy, [math_call('call_1', '2 + 2')]);

    const carried = math_call('call_2', '3 + 3');
    expect(await policy.decide([carried])).toEqual({ kind: 'run' });
    expect(await run_the_call(fixture, policy, carried)).toMatchObject({
      ok: true,
      content_json: { result: '6' },
    });
  });

  it('announces the approved call once, in the row it was held in', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const to_the_chat = chat_sink(fixture);
    const policy = create_tool_batch_policy(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.actor.agent_id,
      emit_chat_stream_event_drafts: to_the_chat,
      actor_id: fixture.actor.user_id,
    });
    policy.set_run_tools(run_tools(fixture));
    const held = math_call('call_1', '2 + 2');

    await approve(fixture, policy, [held]);
    await run_the_call(fixture, policy, held, to_the_chat);

    const [row] = await list_calls(fixture);
    expect(row?.tool_status).toBe('completed');
    expect(await read_chat_labels_for(fixture, row?.tool_call_id ?? '')).toEqual([
      'item_started',
      'item_completed',
    ]);
  });

  it('names the carried call, so the gate behind a transport tool finds the answer', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const policy = create_policy(fixture);
    await approve(fixture, policy, [math_call('call_1', '2 + 2')]);

    const carried = transport_call('call_2', 'math-calculate-1', { expression: '3 + 3' });
    expect(await policy.decide([carried])).toEqual({ kind: 'run' });
    expect(policy.read_approval_grant('call_2')).toMatchObject({
      answer: 'already_given',
      node_key: 'math-calculate-1',
    });
  });

  it('still asks about a different tool the same run has not been told about', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    const policy = create_policy(fixture);

    await approve(fixture, policy, [search_call('call_1', 'opening times')]);

    expect((await policy.decide([write_file_call('call_2')])).kind).toBe('needs_approval');
  });

  it('carries nothing when the person said no', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    const policy = create_policy(fixture);

    await answer(fixture, policy, [search_call('call_1', 'opening times')], 'denied');

    expect((await policy.decide([search_call('call_2', 'closing times')])).kind).toBe(
      'needs_approval',
    );
  });

  it('asks again in a different run, because the carry belongs to the run', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    await approve(fixture, create_policy(fixture), [search_call('call_1', 'opening times')]);

    expect((await create_policy(fixture).decide([search_call('call_2', 'closing')])).kind).toBe(
      'needs_approval',
    );
  });

  it('carries the answer into the run started to finish the step', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const answered = await park_a_step_and_answer_it(fixture, 'approved');

    const continuation = await resume_policy(fixture, answered.job_id);

    expect(await continuation.decide([math_call('call_2', '2 + 2')])).toEqual({ kind: 'run' });
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('carries nothing into that run when the person said no', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    const answered = await park_a_step_and_answer_it(fixture, 'denied');

    const continuation = await resume_policy(fixture, answered.job_id);

    expect((await continuation.decide([math_call('call_2', '2 + 2')])).kind).toBe('needs_approval');
  });
});

describe('a tool allowed for this chat', () => {
  it('stops asking about a granted tool, in a run that never asked about it', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    await allow_in_this_chat(fixture, 'runtime-web_search-1');

    expect(await decide(fixture, [search_call('call_1', 'opening times')])).toEqual({
      kind: 'run',
    });
    expect(await list_waits(fixture)).toEqual([]);
  });

  it('runs the granted call, rather than hiding the question and refusing the tool', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);
    await allow_in_this_chat(fixture, 'math-calculate-1');
    const policy = create_policy(fixture);

    const granted = math_call('call_1', '2 + 2');
    expect(await policy.decide([granted])).toEqual({ kind: 'run' });
    expect(await run_the_call(fixture, policy, granted)).toMatchObject({
      ok: true,
      content_json: { result: '4' },
    });
  });

  it('still asks in a different chat', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    await allow_in_this_chat(fixture, 'runtime-web_search-1');
    const elsewhere = await create_fixture();
    await ask_before(elsewhere, 'every_tool');

    expect((await decide(elsewhere, [search_call('call_1', 'opening times')])).kind).toBe(
      'needs_approval',
    );
  });

  it('refuses a call in the same turn that nothing said yes to', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');
    await allow_in_this_chat(fixture, 'math-calculate-1');
    const policy = create_policy(fixture);
    await policy.decide([math_call('call_1', '2 + 2')]);

    expect(
      await run_the_call(fixture, policy, search_call('call_2', 'opening times')),
    ).toMatchObject({ ok: false, error_code: 'approval_required' });
  });
});

describe('what a held call says it is about', () => {
  it('puts the query on a web search card and nothing else', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    await decide(fixture, [
      {
        tool_call_id: 'call_1',
        tool_name: 'runtime-web_search-1',
        input: { query: 'opening times' },
      },
    ]);

    const view = await read_tool_approval_view(
      fixture.db,
      fixture.actor.workspace_id,
      (await list_waits(fixture))[0] as never,
    );
    expect(read_card_field_lines(build_approval_card(view as never))).toEqual([
      '*Query:* opening times',
    ]);
  });

  it('leaves out the machinery the schema filled in for the model', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    await decide(fixture, [
      {
        tool_call_id: 'call_1',
        tool_name: 'runtime-web_search-1',
        input: { query: 'opening times', topic: 'news', provider: 'tavily', max_results: 3 },
      },
    ]);

    const view = await read_tool_approval_view(
      fixture.db,
      fixture.actor.workspace_id,
      (await list_waits(fixture))[0] as never,
    );
    const lines = read_card_field_lines(build_approval_card(view as never));
    expect(lines).toEqual(['*Query:* opening times']);
    expect(lines.join('\n')).not.toContain('tavily');
  });

  it('says what a Slack message is and where it goes', async () => {
    const fixture = await create_fixture();
    await ask_before(fixture, 'every_tool');

    await decide(fixture, [
      {
        tool_call_id: 'call_1',
        tool_name: 'slack-send_message-1',
        input: { channel_id: 'C1', message: 'The deck is ready.' },
      },
    ]);

    const view = await read_tool_approval_view(
      fixture.db,
      fixture.actor.workspace_id,
      (await list_waits(fixture))[0] as never,
    );
    expect(read_card_field_lines(build_approval_card(view as never))).toEqual([
      '*Message:* The deck is ready.',
      '*Channel:* C1',
    ]);
  });
});

function read_card_field_lines(card: { blocks: unknown[] }) {
  const sections = card.blocks.filter(
    (block): block is { type: string; text: { text: string } } =>
      (block as { type?: string }).type === 'section',
  );
  const [, fields] = sections;
  return fields ? fields.text.text.split('\n') : [];
}

async function forget_the_exemption_in_the_catalog(fixture: Fixture, node_key: string) {
  const node = await fixture.db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, node_key),
  });
  if (!node) throw new Error(`Catalog node missing: ${node_key}`);
  const { policy_exempt: _dropped, ...rest } = node.metadata as Record<string, unknown>;
  await fixture.db.update(nodes).set({ metadata: rest }).where(eq(nodes.node_key, node_key));
}

function math_call(tool_call_id: string, expression: string) {
  return { tool_call_id, tool_name: 'math-calculate-1', input: { expression } };
}

function transport_call(tool_call_id: string, node_key: string, input: Record<string, unknown>) {
  return { tool_call_id, tool_name: 'runtime-execute_tool-1', input: { node_key, input } };
}

function browser_call(tool_call_id: string) {
  return { tool_call_id, tool_name: browser_tool_name, input: { command: 'goto example.com' } };
}

function write_file_call(tool_call_id: string) {
  return {
    tool_call_id,
    tool_name: 'workspace-write_file',
    input: { path: 'notes.md', content: 'hello' },
  };
}

function grep_call(tool_call_id: string) {
  return { tool_call_id, tool_name: 'workspace-grep', input: { pattern: 'hello' } };
}

function decide(
  fixture: Fixture,
  calls: Array<{ tool_call_id: string; tool_name: string; input: unknown }>,
  actor_id?: string,
) {
  return create_policy(fixture, actor_id).decide(calls);
}

function create_policy(fixture: Fixture, actor_id?: string) {
  const policy = create_tool_batch_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.actor.agent_id,
    actor_id: actor_id ?? fixture.actor.user_id,
  });
  policy.set_run_tools(run_tools(fixture));
  return policy;
}

function search_call(tool_call_id: string, query: string) {
  return { tool_call_id, tool_name: 'runtime-web_search-1', input: { query } };
}

function run_the_call(
  fixture: Fixture,
  policy: ReturnType<typeof create_policy>,
  call: { tool_call_id: string; tool_name: string; input: unknown },
  emit_chat_stream_event_drafts?: ReturnType<typeof chat_sink>,
) {
  const tool = create_runtime_tool_definitions(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
    read_approval_grant: policy.read_approval_grant,
    ...(emit_chat_stream_event_drafts ? { emit_chat_stream_event_drafts } : {}),
  }).find((definition) => definition.tool_name === call.tool_name);
  if (!tool?.execute) throw new Error(`This run cannot run ${call.tool_name}.`);
  return tool.execute(call.input, {
    run_key: fixture.run.run_id,
    tool_call_id: call.tool_call_id,
    metadata: {},
  });
}

async function approve(
  fixture: Fixture,
  policy: ReturnType<typeof create_policy>,
  calls: Array<{ tool_call_id: string; tool_name: string; input: unknown }>,
) {
  return answer(fixture, policy, calls, 'approved');
}

async function answer(
  fixture: Fixture,
  policy: ReturnType<typeof create_policy>,
  calls: Array<{ tool_call_id: string; tool_name: string; input: unknown }>,
  decision: 'approved' | 'denied',
  reason?: string,
) {
  const asked = await policy.decide(calls);
  if (asked.kind !== 'needs_approval') throw new Error('Expected the step to ask.');
  const wait = (await list_waits(fixture))[0];
  if (!wait) throw new Error('Expected an open question.');
  await record_the_answer(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    job_id: wait.job_id,
    queue_key: wait.awaits_queue_key ?? wait.queue_key,
    decided_by: fixture.actor.user_id,
    decision,
    reason,
  });
  return asked.wait_for_answer();
}

async function park_a_step_and_answer_it(fixture: Fixture, decision: 'approved' | 'denied') {
  const asked = await create_policy(fixture).decide([math_call('call_1', '2 + 2')]);
  if (asked.kind !== 'needs_approval') throw new Error('Expected the step to ask.');
  const wait = (await list_waits(fixture))[0];
  if (!wait) throw new Error('Expected an open question.');
  await record_the_answer(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    job_id: wait.job_id,
    queue_key: wait.awaits_queue_key ?? wait.queue_key,
    decided_by: fixture.actor.user_id,
    decision,
  });
  return { job_id: wait.job_id };
}

async function resume_policy(fixture: Fixture, resumed_from_job_id: string) {
  const run = await create_run(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.actor.agent_id,
    trigger_type: 'user_message',
    resumed_from_job_id,
    actor_id: fixture.actor.user_id,
  });
  const policy = create_tool_batch_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: run.run_id,
    agent_id: fixture.actor.agent_id,
    resumed_from_job_id,
    actor_id: fixture.actor.user_id,
  });
  policy.set_run_tools(run_tools(fixture));
  return policy;
}

async function allow_in_this_chat(fixture: Fixture, node_key: string) {
  await add_session_approval_grants(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    node_keys: [node_key],
    granted_by: fixture.actor.user_id,
  });
}

const exempt_run_tool: RuntimeToolDefinition = {
  tool_name: 'runtime-exempt_probe-1',
  description: 'A run tool that opts out of every policy.',
  metadata: { policy_exempt: true },
};

function run_tools(fixture: Fixture): RuntimeToolDefinition[] {
  return [
    ...create_runtime_tool_definitions(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      agent_id: fixture.actor.agent_id,
      actor_id: fixture.actor.user_id,
    }),
    ...create_browser_tool_definitions(fixture.db, browser_assembly_input(fixture), 'direct'),
    exempt_run_tool,
  ];
}

function browser_assembly_input(fixture: Fixture): BrowserToolAssemblyInput {
  return {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
    environment: {
      env_key: 'sandbox_1',
      env_kind: 'remote_sandbox',
      metadata: { provider_sandbox_id: 'sandbox_1' },
      exec: () => Promise.resolve({ exit_code: 0, stdout: '', stderr: '' }),
    },
  };
}

function list_calls(fixture: Fixture) {
  return list_run_tool_calls(fixture.db, fixture.actor.workspace_id, fixture.run.run_id);
}

function chat_sink(fixture: Fixture) {
  return async (drafts: Parameters<typeof record_chat_stream_event_drafts>[1]['drafts']) => {
    await record_chat_stream_event_drafts(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      session_id: fixture.session.session_id,
      run_id: fixture.run.run_id,
      drafts,
      actor_id: fixture.actor.user_id,
    });
  };
}

async function read_chat_labels_for(fixture: Fixture, tool_call_id: string) {
  const rows = await list_run_chat_events(
    fixture.db,
    fixture.actor.workspace_id,
    fixture.run.run_id,
  );
  return rows
    .filter(
      (row) =>
        (row.event_data as { item?: { tool_call_id?: string } }).item?.tool_call_id ===
        tool_call_id,
    )
    .map((row) => row.event_label);
}

function read_run_events(fixture: Fixture) {
  return list_run_events(fixture.db, fixture.actor.workspace_id, fixture.run.run_id, {
    limit: 200,
  });
}

async function read_pause_rows(fixture: Fixture) {
  const rows = await read_run_events(fixture);
  return rows.filter((row) => row.event_label === tool_policy_awaiting_approval_event_label);
}

function list_waits(fixture: Fixture) {
  return list_tool_policy_waits(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    status: 'waiting',
  });
}

async function ask_before_math(fixture: Fixture) {
  await set_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    resource_type: 'node',
    resource_id: 'math-calculate-1',
    scope_type: 'workspace',
    scope_id: fixture.actor.workspace_id,
    policy_mode: 'ask',
    actor_id: fixture.actor.user_id,
  });
}

async function ask_before(fixture: Fixture, label: string) {
  await set_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    resource_type: 'node_label',
    resource_id: label,
    scope_type: 'workspace',
    scope_id: fixture.actor.workspace_id,
    policy_mode: 'ask',
    actor_id: fixture.actor.user_id,
  });
}

async function create_fixture(
  options: { session_source?: CreateSessionInput['session_source'] } = {},
) {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    ...(options.session_source ? { session_source: options.session_source } : {}),
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  return { db, actor, session, run };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;
