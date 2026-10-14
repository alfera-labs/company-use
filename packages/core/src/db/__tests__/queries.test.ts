import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '@coworker/config';
import { default_project_display_name } from '@coworker/config/constants';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { seed_internal_catalog } from '@coworker/core/db/queries/catalog';
import { create_eval_report, list_eval_reports } from '@coworker/core/db/queries/evals';
import {
  create_sandbox_url_preview_url,
  list_session_sandbox_url_previews,
  resolve_sandbox_url_preview_route,
} from '@coworker/core/db/queries/runtime_environments';
import {
  acquire_session_execution_lock,
  archive_session,
  cancel_run,
  create_run,
  create_run_event,
  create_run_message,
  create_run_messages,
  create_run_model_context_snapshot,
  create_runtime_environment,
  create_session,
  create_session_context_operation,
  create_tool_call_started,
  create_usage_record,
  find_sandbox_by_mount_key,
  get_runtime_environment,
  get_session,
  hide_run_messages_from_model,
  list_run_events,
  list_run_model_context_snapshots,
  list_run_tool_calls,
  list_session_context_operations,
  list_session_messages,
  list_sessions,
  renew_session_execution_lock,
  update_agent,
  update_run_performance_metrics,
  update_run_status,
  update_session_context_summary,
  update_tool_call_finished,
  upsert_runtime_environment_active_preview,
  upsert_sandbox_by_mount_key,
} from '@coworker/core/db/queries/sessions';
import { agents, sessions, workspaces } from '@coworker/core/db/schema';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('runtime persistence queries', () => {
  it('stores model providers in existing columns and proxies in JSONB metadata', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Model route persistence',
      actor_id: bootstrap.user_id,
    });

    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
      actor_id: bootstrap.user_id,
    });
    const usage = await create_usage_record(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_id: session.session_id,
      run_id: run.run_id,
      usage_kind: 'llm_tokens',
      quantity: '42',
      unit: 'token',
      provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      usage_metadata: { source: 'test' },
      actor_id: bootstrap.user_id,
    });

    expect(run).toMatchObject({
      model_provider: 'anthropic',
      provider_name: 'anthropic',
      run_metadata: { model_proxy: 'vercel_ai_gateway' },
    });
    expect(usage).toMatchObject({
      provider: 'anthropic',
      provider_name: 'anthropic',
      usage_metadata: {
        source: 'test',
        model_proxy: 'vercel_ai_gateway',
      },
    });
  });

  it('creates sessions, runs, messages, and tool calls with durable IDs', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_internal_catalog(db);

    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Research accounts',
      actor_id: bootstrap.user_id,
    });

    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'running',
      actor_id: bootstrap.user_id,
    });

    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Find the accounts' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });

    await create_run_event(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      event_type: 'start',
      event_label: 'start',
      event_data: { event_type: 'start' },
      actor_id: bootstrap.user_id,
    });

    await create_run_model_context_snapshot(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      snapshot_kind: 'runtime_context',
      model_provider: 'openai',
      model_name: 'gpt-5.5',
      message_count: 1,
      tool_count: 1,
      token_estimate: 42,
      snapshot: { messages: [{ role: 'user', content: 'Find the accounts' }] },
      actor_id: bootstrap.user_id,
    });

    const tool_call = await create_tool_call_started(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      tool_name: 'runtime-search_context-1',
      tool_input: { query: 'accounts' },
      actor_id: bootstrap.user_id,
    });

    await create_run_event(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      tool_call_id: tool_call.tool_call_id,
      event_type: 'progress',
      event_label: 'tool_call.started',
      event_data: { tool_call_id: tool_call.tool_call_id },
      actor_id: bootstrap.user_id,
    });

    await update_tool_call_finished(db, {
      tool_call_id: tool_call.tool_call_id,
      tool_status: 'completed',
      output: { success: true },
      duration_ms: 3,
      actor_id: bootstrap.user_id,
    });
    await update_run_performance_metrics(db, {
      run_id: run.run_id,
      context_compile_ms: 4,
      engine_first_event_ms: 5,
      model_total_ms: 6,
      tool_total_ms: 3,
      db_write_total_ms: 7,
      total_run_ms: 8,
      actor_id: bootstrap.user_id,
    });
    await create_eval_report(db, {
      suite_name: 'smoke',
      task_source: 'internal',
      task_id: 'trace_001_context_snapshot_exists',
      run_id: run.run_id,
      runtime_environment_id: null,
      harness_version: 'test',
      runtime_version: 'test',
      model_id: 'eval/minimal-trust-loop',
      status: 'pass',
      duration_ms: 8,
      tool_call_count: 1,
      trace_pointer: `run:${run.run_id}`,
      actor_id: bootstrap.user_id,
    });

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const events = await list_run_events(db, bootstrap.workspace_id, run.run_id);
    const tool_events = await list_run_events(db, bootstrap.workspace_id, run.run_id, {
      tool_call_id: tool_call.tool_call_id,
    });
    const snapshots = await list_run_model_context_snapshots(
      db,
      bootstrap.workspace_id,
      run.run_id,
    );
    const tool_calls = await list_run_tool_calls(db, bootstrap.workspace_id, run.run_id);
    const eval_reports = await list_eval_reports(db, {
      suite_name: 'smoke',
      runtime_version: 'test',
    });

    expect(session.session_id).toMatch(/^ses_/);
    expect(run.run_id).toMatch(/^run_/);
    expect(messages).toHaveLength(1);
    expect(events[0]?.event_type).toBe('start');
    expect(tool_events).toHaveLength(1);
    expect(tool_events[0]).toMatchObject({
      tool_call_id: tool_call.tool_call_id,
      event_label: 'tool_call.started',
    });
    expect(snapshots[0]?.snapshot_kind).toBe('runtime_context');
    expect(tool_calls[0]?.tool_status).toBe('completed');
    expect(eval_reports[0]).toMatchObject({
      suite_name: 'smoke',
      task_id: 'trace_001_context_snapshot_exists',
      run_id: run.run_id,
      status: 'pass',
    });
  });

  it('allocates unique run event sequences for overlapping requests', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    const created_events = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        create_run_event(db, {
          workspace_id: bootstrap.workspace_id,
          session_id: session.session_id,
          run_id: run.run_id,
          event_type: 'progress',
          event_label: `parallel_${index}`,
          actor_id: bootstrap.user_id,
        }),
      ),
    );

    expect(created_events.map((event) => event.event_sequence).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    await expect(list_run_events(db, bootstrap.workspace_id, run.run_id)).resolves.toHaveLength(6);
  });

  it('stores assistant output messages that include tool call parts', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Tool call output',
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: {
        type: 'text',
        text: 'I found Slack connected, but Stripe, HubSpot, and Google Sheets still need connections.',
        parts: [
          {
            type: 'text',
            text: 'I found Slack connected, but Stripe, HubSpot, and Google Sheets still need connections.',
            text_signature: '{"v":1,"id":"msg_test","phase":"commentary"}',
            text_signature_data: { v: 1, id: 'msg_test', phase: 'commentary' },
          },
          {
            type: 'tool_call',
            id: 'call_stripe',
            name: 'runtime-create_connection-1',
            arguments: { app_name: 'stripe', connection_name: 'Stripe' },
          },
          {
            type: 'tool_call',
            id: 'call_hubspot',
            name: 'runtime-create_connection-1',
            arguments: { app_name: 'hubspot', connection_name: 'HubSpot' },
          },
          {
            type: 'tool_call',
            id: 'call_google_sheets',
            name: 'runtime-create_connection-1',
            arguments: { app_name: 'google_sheets', connection_name: 'Google Sheets' },
          },
        ],
      },
      source_type: 'runtime',
      source_metadata: { has_visible_text: true },
      actor_id: bootstrap.user_id,
    });

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      message_role: 'assistant',
      message_kind: 'output',
      message_sequence: 1,
      run_message_sequence: 1,
      content_text:
        'I found Slack connected, but Stripe, HubSpot, and Google Sheets still need connections.',
      message_content: expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_call', name: 'runtime-create_connection-1' }),
        ]),
      }),
    });
  });

  it('persists a debounced message batch with contiguous sequences and one final preview', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    const common = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      source_type: 'slack' as const,
      actor_id: bootstrap.user_id,
    };

    await create_run_messages(db, [
      {
        ...common,
        message_role: 'user',
        message_content: { type: 'text', text: 'First debounced message' },
      },
      {
        ...common,
        message_role: 'assistant',
        message_content: { type: 'text', text: 'Hidden context' },
        is_user_visible: false,
      },
      {
        ...common,
        message_role: 'user',
        message_content: { type: 'text', text: 'Final debounced message' },
      },
    ]);
    const session_after_batch = await get_session(db, bootstrap.workspace_id, session.session_id);
    await create_run_message(db, {
      ...common,
      message_role: 'assistant',
      message_content: { type: 'text', text: 'Answer' },
      source_type: 'runtime',
    });

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const updated_session = await get_session(db, bootstrap.workspace_id, session.session_id);

    expect(messages.map((message) => message.message_sequence)).toEqual([1, 2, 3, 4]);
    expect(messages.map((message) => message.run_message_sequence)).toEqual([1, 2, 3, 4]);
    expect(session_after_batch?.last_message_preview).toBe('Final debounced message');
    expect(updated_session?.last_message_preview).toBe('Answer');
  });

  it('allocates contiguous message sequences across concurrent writers', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const create_test_run = () =>
      create_run(db, {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        agent_id: bootstrap.agent_id,
        trigger_type: 'user_message',
        actor_id: bootstrap.user_id,
      });
    const first_run = await create_test_run();
    const second_run = await create_test_run();
    const message = (run_id: string, text: string) => ({
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id,
      message_role: 'user' as const,
      message_content: { type: 'text' as const, text },
      source_type: 'slack' as const,
      actor_id: bootstrap.user_id,
    });

    await Promise.all([
      create_run_messages(db, [
        message(first_run.run_id, 'First run, one'),
        message(first_run.run_id, 'First run, two'),
      ]),
      create_run_message(db, message(second_run.run_id, 'Second run, one')),
      create_run_messages(db, [
        message(second_run.run_id, 'Second run, two'),
        message(second_run.run_id, 'Second run, three'),
      ]),
    ]);

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const first_run_sequences = messages
      .filter((item) => item.run_id === first_run.run_id)
      .map((item) => item.run_message_sequence)
      .sort((a, b) => a - b);
    const second_run_sequences = messages
      .filter((item) => item.run_id === second_run.run_id)
      .map((item) => item.run_message_sequence)
      .sort((a, b) => a - b);

    expect(messages.map((item) => item.message_sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(first_run_sequences).toEqual([1, 2]);
    expect(second_run_sequences).toEqual([1, 2, 3]);
  });

  it('rejects mixed message batches without changing the session', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    const input = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'user' as const,
      message_content: { type: 'text' as const, text: 'Original' },
      source_type: 'slack' as const,
      actor_id: bootstrap.user_id,
    };

    await expect(create_run_messages(db, [])).resolves.toEqual([]);
    for (const changed_owner of [
      { workspace_id: 'wrk_other' },
      { session_id: 'ses_other' },
      { run_id: 'run_other' },
    ]) {
      await expect(
        create_run_messages(db, [input, { ...input, ...changed_owner }]),
      ).rejects.toThrow('A run-message batch must belong to one workspace, session, and run');
    }

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const unchanged_session = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(messages).toEqual([]);
    expect(unchanged_session?.last_message_time).toBeNull();
    expect(unchanged_session?.last_message_preview).toBeNull();
  });

  it('does not move the session timestamp backward after waiting for its row lock', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    let report_lock_acquired: () => void = () => {};
    const lock_acquired = new Promise<void>((resolve) => {
      report_lock_acquired = resolve;
    });
    let release_lock: () => void = () => {};
    const lock_release = new Promise<void>((resolve) => {
      release_lock = resolve;
    });
    const blocking_update = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM ${sessions}
        WHERE ${sessions.session_id} = ${session.session_id}
        FOR UPDATE
      `);
      report_lock_acquired();
      await lock_release;
      const [updated] = await tx
        .update(sessions)
        .set({
          last_message_time: sql`clock_timestamp()`,
          last_updated_time: sql`clock_timestamp()`,
          last_updated_by: bootstrap.user_id,
        })
        .where(eq(sessions.session_id, session.session_id))
        .returning({ last_message_time: sessions.last_message_time });
      if (!updated?.last_message_time) throw new Error('Blocking timestamp update failed');
      return updated.last_message_time;
    });
    await lock_acquired;
    const blocked_writer = create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Waited for the session lock' },
      source_type: 'slack',
      actor_id: bootstrap.user_id,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release_lock();
    const [blocking_timestamp] = await Promise.all([blocking_update, blocked_writer]);

    const updated_session = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(updated_session?.last_message_time?.getTime()).toBeGreaterThanOrEqual(
      blocking_timestamp.getTime(),
    );
    expect(updated_session?.last_message_preview).toBe('Waited for the session lock');
  });

  it('upserts sandboxes by provider mount key without racing the unique index', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Sandbox upsert test',
      actor_id: bootstrap.user_id,
    });
    const workspace_mount_key = `${bootstrap.workspace_id}:${session.session_id}`;
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'pending',
      workspace_mount_key,
      root_path: '/work',
      actor_id: bootstrap.user_id,
    });

    const first = await upsert_sandbox_by_mount_key(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      sandbox_provider: 'e2b',
      sandbox_status: 'starting',
      provider_template_id: 'template_a',
      workspace_mount_key,
      root_path: '/work',
      working_directory: '/work/repo',
      sandbox_metadata: { host_workspace_root: '/tmp/a' },
      actor_id: bootstrap.user_id,
    });
    const second = await upsert_sandbox_by_mount_key(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      sandbox_provider: 'e2b',
      sandbox_status: 'running',
      provider_sandbox_id: 'sbox_live',
      provider_template_id: 'template_b',
      workspace_mount_key,
      root_path: '/work',
      working_directory: '/work/repo',
      sandbox_metadata: { host_workspace_root: '/tmp/b' },
      actor_id: bootstrap.user_id,
    });
    const found = await find_sandbox_by_mount_key(db, {
      workspace_id: bootstrap.workspace_id,
      sandbox_provider: 'e2b',
      workspace_mount_key,
    });

    expect(second.sandbox_id).toBe(first.sandbox_id);
    expect(found).toMatchObject({
      sandbox_id: first.sandbox_id,
      sandbox_status: 'running',
      provider_sandbox_id: 'sbox_live',
      provider_template_id: 'template_b',
      sandbox_metadata: { host_workspace_root: '/tmp/b' },
    });
  });

  it('allocates model context snapshot sequences per run and kind', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await create_run_model_context_snapshot(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      snapshot_kind: 'compaction',
      message_count: 0,
      tool_count: 0,
      token_estimate: 100,
      snapshot: { summary: 'first compaction' },
      actor_id: bootstrap.user_id,
    });
    await create_run_model_context_snapshot(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      snapshot_kind: 'compaction',
      message_count: 0,
      tool_count: 0,
      token_estimate: 80,
      snapshot: { summary: 'second compaction' },
      actor_id: bootstrap.user_id,
    });

    const snapshots = await list_run_model_context_snapshots(
      db,
      bootstrap.workspace_id,
      run.run_id,
    );

    expect(snapshots.map((snapshot) => snapshot.snapshot_sequence)).toEqual([1, 2]);
    expect(snapshots.map((snapshot) => snapshot.snapshot_kind)).toEqual([
      'compaction',
      'compaction',
    ]);
  });

  it('hides what a failed run produced but never the user message that started it', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'the request' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: 'half-finished answer' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });
    await hide_run_messages_from_model(db, {
      workspace_id: bootstrap.workspace_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
    });

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    expect(messages).toHaveLength(2);
    expect(messages.find((message) => message.message_role === 'user')).toMatchObject({
      content_text: 'the request',
      is_model_visible: true,
      is_user_visible: true,
    });
    expect(messages.find((message) => message.message_role === 'assistant')).toMatchObject({
      content_text: 'half-finished answer',
      is_model_visible: false,
      is_user_visible: true,
    });
  });

  it('keeps tool-call/result pairs visible when hiding a cancelled run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: {
        type: 'multimodal',
        parts: [
          { type: 'text', text: 'reading the template' },
          { type: 'tool_call', id: 'toolu_1', name: 'workspace-read_file', arguments: {} },
        ],
      },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'tool_result',
      message_content: {
        type: 'multimodal',
        parts: [
          {
            type: 'tool_result',
            tool_call_id: 'toolu_1',
            result: { ok: true, content_text: 'the template body' },
          },
        ],
      },
      source_type: 'tool',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: 'a narrative the cancel interrupts' },
      source_type: 'runtime',
      actor_id: bootstrap.user_id,
    });

    await hide_run_messages_from_model(db, {
      workspace_id: bootstrap.workspace_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
    });

    const messages = await list_session_messages(db, bootstrap.workspace_id, session.session_id);
    const by_role_and_kind = messages.map((message) => ({
      role: message.message_role,
      visible: message.is_model_visible,
    }));
    expect(by_role_and_kind).toEqual([
      { role: 'assistant', visible: true },
      { role: 'tool_result', visible: true },
      { role: 'assistant', visible: false },
    ]);
  });

  it('persists context summary metadata without replacing other session metadata', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    const updated = await update_session_context_summary(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      context_summary: 'Pi compacted summary',
      summarized_until_message_id: 'msg_boundary',
      context_summary_metadata: {
        source: 'pi_agent_harness_compaction',
        first_kept_entry_id: 'msg_next',
      },
      actor_id: bootstrap.user_id,
    });

    expect(updated).not.toBeNull();
    expect(updated?.context_summary).toBe('Pi compacted summary');
    expect(updated?.summarized_until_message_id).toBe('msg_boundary');
    expect(updated?.session_metadata).toMatchObject({
      context_summary: {
        source: 'pi_agent_harness_compaction',
        first_kept_entry_id: 'msg_next',
      },
    });
  });

  it('only writes a context summary when the expected boundary still matches', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const summary_write = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      actor_id: bootstrap.user_id,
    };

    const first = await update_session_context_summary(db, {
      ...summary_write,
      context_summary: 'first summary',
      summarized_until_message_id: 'msg_10',
      expected_summarized_until_message_id: null,
    });
    expect(first?.summarized_until_message_id).toBe('msg_10');

    const stale = await update_session_context_summary(db, {
      ...summary_write,
      context_summary: 'stale summary',
      summarized_until_message_id: 'msg_4',
      expected_summarized_until_message_id: null,
    });
    expect(stale).toBeNull();

    const unchanged = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(unchanged?.context_summary).toBe('first summary');
    expect(unchanged?.summarized_until_message_id).toBe('msg_10');

    const next = await update_session_context_summary(db, {
      ...summary_write,
      context_summary: 'second summary',
      summarized_until_message_id: 'msg_20',
      expected_summarized_until_message_id: 'msg_10',
    });
    expect(next?.context_summary).toBe('second summary');
    expect(next?.summarized_until_message_id).toBe('msg_20');
  });

  it('persists context operations separately from run event breadcrumbs', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    const operation = await create_session_context_operation(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      operation_type: 'compact',
      target_entry_ids: ['entry_old'],
      operation_data: { summary: 'old context summary', first_kept_entry_id: 'entry_new' },
      operation_reason: 'context_budget_exceeded',
      actor_id: bootstrap.user_id,
    });
    await create_run_event(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      event_type: 'progress',
      event_label: 'context_operation.compact',
      event_data: {
        operation_id: operation.session_context_operation_id,
        operation_type: operation.operation_type,
      },
      actor_id: bootstrap.user_id,
    });

    const operations = await list_session_context_operations(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
    });
    const events = await list_run_events(db, bootstrap.workspace_id, run.run_id);

    expect(operations[0]).toMatchObject({
      operation_type: 'compact',
      operation_reason: 'context_budget_exceeded',
    });
    expect(operations[0]?.target_entry_ids).toEqual(['entry_old']);
    expect(events[0]?.event_label).toBe('context_operation.compact');
  });

  it('repairs stale bootstrap defaults in existing local data', async () => {
    const db = await create_test_database();
    const actor_id = 'test';
    const stale_default_name = ['Runtime', 'Core'].join(' ');

    await db.insert(workspaces).values({
      workspace_id: 'wrk_legacy',
      workspace_name: stale_default_name,
      workspace_slug: 'default',
      workspace_status: 'active',
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    await db.insert(agents).values({
      agent_id: 'agt_legacy',
      workspace_id: 'wrk_legacy',
      agent_slug: 'main',
      agent_name: `${stale_default_name} worker`,
      agent_description: 'Legacy local worker.',
      agent_status: 'active',
      agent_kind: 'main',
      system_prompt: 'Old bootstrap instructions.',
      default_model: 'legacy-model',
      default_model_provider: 'local',
      default_model_name: 'legacy-model',
      agent_config: { enabled_nodes: ['slack', 'gmail'] },
      created_by: actor_id,
      last_updated_by: actor_id,
    });

    const bootstrap = await bootstrap_default_workspace(db);

    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.workspace_id, bootstrap.workspace_id),
    });
    const agent = await db.query.agents.findFirst({
      where: eq(agents.agent_id, bootstrap.agent_id),
    });

    expect(bootstrap.workspace_id).toBe('wrk_legacy');
    expect(bootstrap.agent_id).toBe('agt_legacy');
    expect(workspace?.workspace_name).toBe(default_project_display_name);
    expect(agent?.agent_slug).toBe('main');
    expect(agent?.agent_name).toBe(`${default_project_display_name} worker`);
    expect(agent?.default_model_provider).toBe('openai');
    expect(agent?.default_model_name).toBe('gpt-6-luna');
    expect(agent?.system_prompt).not.toContain('Old bootstrap instructions');
    expect(agent?.agent_config).toMatchObject({
      enabled_nodes: ['slack', 'gmail'],
      model_proxy: 'openai_direct',
      reasoning_level: 'high',
    });
  });

  it('preserves a workspace model choice during later bootstrap requests', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await db
      .update(agents)
      .set({
        default_model: 'zai/glm-5.2',
        default_model_provider: 'zai',
        default_model_name: 'zai/glm-5.2',
        agent_config: { model_proxy: 'vercel_ai_gateway' },
      })
      .where(eq(agents.agent_id, bootstrap.agent_id));
    await bootstrap_default_workspace(db);
    const refreshed = await db.query.agents.findFirst({
      where: eq(agents.agent_id, bootstrap.agent_id),
    });

    expect(refreshed).toMatchObject({
      default_model: 'zai/glm-5.2',
      default_model_provider: 'zai',
      default_model_name: 'zai/glm-5.2',
      agent_config: { model_proxy: 'vercel_ai_gateway' },
    });
  });

  it('stores the model provider and proxy without replacing other agent settings', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db
      .update(agents)
      .set({ agent_config: { enabled_nodes: ['search_context'] } })
      .where(eq(agents.agent_id, bootstrap.agent_id));

    const agent = await update_agent(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      default_model: {
        model_provider: 'zai',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'zai/glm-5.2',
      },
      actor_id: bootstrap.user_id,
    });

    expect(agent).toMatchObject({
      default_model_provider: 'zai',
      default_model_name: 'zai/glm-5.2',
      agent_config: {
        enabled_nodes: ['search_context'],
        model_proxy: 'vercel_ai_gateway',
      },
    });
  });

  it('moves agents still on a previous default prompt to the current default, leaving custom prompts alone', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const previous_default_prompt =
      'You are a business-facing AI worker. Be concrete, use connected tools when useful, and report what happened.';

    await db
      .update(agents)
      .set({ system_prompt: previous_default_prompt })
      .where(eq(agents.agent_id, bootstrap.agent_id));
    await bootstrap_default_workspace(db);
    const refreshed = await db.query.agents.findFirst({
      where: eq(agents.agent_id, bootstrap.agent_id),
    });
    expect(refreshed?.system_prompt).toContain('own each request end to end');

    const custom_prompt = 'You are the finance desk bot. Only answer billing questions.';
    await db
      .update(agents)
      .set({ system_prompt: custom_prompt })
      .where(eq(agents.agent_id, bootstrap.agent_id));
    await bootstrap_default_workspace(db);
    const untouched = await db.query.agents.findFirst({
      where: eq(agents.agent_id, bootstrap.agent_id),
    });
    expect(untouched?.system_prompt).toBe(custom_prompt);
  });

  it('renews session execution locks so active runs cannot be stolen after the first lease', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const first_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    const second_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await acquire_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      actor_id: bootstrap.user_id,
      lease_ms: 1,
    });
    await wait_for_milliseconds(5);
    const renewed_session = await renew_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      actor_id: bootstrap.user_id,
      lease_ms: 60_000,
    });
    const stolen_session = await acquire_session_execution_lock(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: second_run.run_id,
      actor_id: bootstrap.user_id,
      lease_ms: 60_000,
    });

    expect(renewed_session?.locked_by_run_id).toBe(first_run.run_id);
    expect(stolen_session).toBeNull();
  });

  it('keeps cancelled runs terminal when later completion tries to write back', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'running',
      actor_id: bootstrap.user_id,
    });
    const cancelled_run = await cancel_run(
      db,
      bootstrap.workspace_id,
      run.run_id,
      bootstrap.user_id,
    );
    const completion_attempt = await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
      current_run_statuses: ['running'],
    });

    expect(cancelled_run.run_status).toBe('cancelled');
    expect(completion_attempt.run_status).toBe('cancelled');
  });

  it('does not rewrite already completed runs as cancelled', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    await update_run_status(db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
    });
    const cancel_attempt = await cancel_run(
      db,
      bootstrap.workspace_id,
      run.run_id,
      bootstrap.user_id,
    );

    expect(cancel_attempt.run_status).toBe('completed');
  });

  it('creates and resolves sandbox preview URLs from active runtime metadata', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Preview session',
      actor_id: bootstrap.user_id,
    });
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'running',
      provider_environment_id: 'sbox_preview_123',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_config: { project_description: 'Sales dashboard' },
      environment_metadata: {
        active_previews: {
          '4848': {
            port: 4848,
            preview_name: 'Browser live view',
            preview_kind: 'browser_live_view',
            preview_transport: 'provider_direct',
            preview_url: 'https://4848-sbox-preview-123.e2b.app',
          },
          '4849': {
            port: 4849,
            preview_name: 'Rejected provider host',
            preview_kind: 'browser_live_view',
            preview_transport: 'provider_direct',
            preview_url: 'https://not-e2b.example',
          },
          '4850': {
            port: 4850,
            preview_name: 'Rejected untyped preview',
            preview_transport: 'provider_direct',
            preview_url: 'https://4850-sbox-preview-123.e2b.app',
          },
        },
        active_preview: {
          port: 5173,
          preview_name: 'Dashboard',
          command: 'npm run dev',
          ready_path: '/',
        },
        active_preview_ports: [5173],
      },
      actor_id: bootstrap.user_id,
    });

    const previews = await list_session_sandbox_url_previews(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      options: {
        preview_base_domain: 'sandboxes.alfera.ai',
        preview_protocol: 'https',
        default_port: 3000,
      },
    });

    expect(previews).toEqual([
      expect.objectContaining({
        runtime_environment_id: runtime_environment.runtime_environment_id,
        preview_name: 'Browser live view',
        preview_kind: 'browser_live_view',
        preview_url: 'https://4848-sbox-preview-123.e2b.app',
        source: 'active',
        port: 4848,
      }),
      expect.objectContaining({
        runtime_environment_id: runtime_environment.runtime_environment_id,
        preview_name: 'Rejected provider host',
        preview_kind: 'browser_live_view',
        preview_url: expect.stringMatching(
          /^https:\/\/sales-dashboard-4849-[a-f0-9]{8}\.sandboxes\.alfera\.ai$/u,
        ),
        source: 'active',
        port: 4849,
      }),
      expect.objectContaining({
        runtime_environment_id: runtime_environment.runtime_environment_id,
        preview_name: 'Rejected untyped preview',
        preview_url: expect.stringMatching(
          /^https:\/\/sales-dashboard-4850-[a-f0-9]{8}\.sandboxes\.alfera\.ai$/u,
        ),
        source: 'active',
        port: 4850,
      }),
      expect.objectContaining({
        runtime_environment_id: runtime_environment.runtime_environment_id,
        preview_name: 'Dashboard',
        preview_url: expect.stringMatching(
          /^https:\/\/sales-dashboard-5173-[a-f0-9]{8}\.sandboxes\.alfera\.ai$/u,
        ),
        source: 'active',
        port: 5173,
      }),
    ]);

    const preview = previews?.find((item) => item.port === 5173);
    expect(preview).toBeDefined();
    const route = await resolve_sandbox_url_preview_route(db, {
      preview_host: preview?.preview_domain ?? '',
      options: {
        preview_base_domain: 'sandboxes.alfera.ai',
        preview_protocol: 'https',
        default_port: 3000,
      },
    });
    expect(route).toMatchObject({
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
      port: 5173,
    });
  });

  it('merges active preview metadata without replacing previews on other ports', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'idle',
      provider_environment_id: 'sbox_preview_merge',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview_ports: [3000],
        active_previews: { '3000': { port: 3000, preview_name: 'App preview' } },
      },
      actor_id: bootstrap.user_id,
    });

    await Promise.all([
      upsert_runtime_environment_active_preview(db, {
        runtime_environment_id: runtime_environment.runtime_environment_id,
        active_preview: { preview_name: 'Browser live view' },
        preview_port: 4848,
        actor_id: bootstrap.user_id,
      }),
      upsert_runtime_environment_active_preview(db, {
        runtime_environment_id: runtime_environment.runtime_environment_id,
        active_preview: { preview_name: 'Dev server' },
        preview_port: 5173,
        actor_id: bootstrap.user_id,
      }),
    ]);

    const updated = await get_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      runtime_environment_id: runtime_environment.runtime_environment_id,
    });
    expect(updated?.environment_status).toBe('idle');
    expect(updated?.environment_metadata).toMatchObject({
      active_previews: {
        '3000': { port: 3000, preview_name: 'App preview' },
        '4848': { port: 4848, preview_name: 'Browser live view' },
        '5173': { port: 5173, preview_name: 'Dev server' },
      },
    });
    expect(
      new Set(
        (updated?.environment_metadata as { active_preview_ports: number[] }).active_preview_ports,
      ),
    ).toEqual(new Set([3000, 4848, 5173]));
  });

  it('does not resolve sandbox preview hosts for inactive runtime environments', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'Inactive preview session',
      actor_id: bootstrap.user_id,
    });
    const runtime_environment = await create_runtime_environment(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      environment_provider: 'e2b',
      environment_status: 'stopped',
      provider_environment_id: 'sbox_stopped_preview',
      workspace_mount_key: `${bootstrap.workspace_id}:${session.session_id}`,
      root_path: '/work',
      environment_metadata: {
        active_preview: { port: 3000, preview_name: 'Stopped app' },
        active_preview_ports: [3000],
      },
      actor_id: bootstrap.user_id,
    });
    const preview_url = create_sandbox_url_preview_url({
      runtime_environment_id: runtime_environment.runtime_environment_id,
      provider_environment_id: runtime_environment.provider_environment_id,
      preview_base_domain: 'sandboxes.alfera.ai',
      preview_protocol: 'https',
      default_port: 3000,
      port: 3000,
      subdomain_seed: 'Stopped app',
    });

    const route = await resolve_sandbox_url_preview_route(db, {
      preview_host: new URL(preview_url).host,
      options: {
        preview_base_domain: 'sandboxes.alfera.ai',
        preview_protocol: 'https',
        default_port: 3000,
      },
    });

    expect(route).toBeNull();
  });

  it('backfills unique agent slugs before creating the workspace slug index', () => {
    const migration_sql = readFileSync(
      resolve(import.meta.dirname, '../migrations/0001_overconfident_tomas.sql'),
      'utf8',
    );
    const backfill_index = migration_sql.indexOf('numbered_workspace_agents');
    const unique_index = migration_sql.indexOf('idx_agents_workspace_slug_unique');

    expect(backfill_index).toBeGreaterThan(-1);
    expect(unique_index).toBeGreaterThan(backfill_index);
  });
});

function wait_for_milliseconds(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('deleted chats and the session listing', () => {
  it('drops a deleted chat from the listing while keeping the row addressable', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_title: 'To be deleted',
      actor_id: bootstrap.user_id,
    });

    await archive_session(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      actor_id: bootstrap.user_id,
    });

    const listed = await list_sessions(db, bootstrap.workspace_id, { visible_to_user_id: null });
    expect(listed.some((row) => row.session_id === session.session_id)).toBe(false);

    const fetched = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(fetched?.session_status).toBe('deleted');
  });
});
