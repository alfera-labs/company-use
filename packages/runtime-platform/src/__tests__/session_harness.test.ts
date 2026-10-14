import { prepare_pi_compaction } from '@agent-core/engines/pi';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session, get_session } from '@coworker/core/db/queries/sessions';
import { build_session_context_from_messages } from '@runtime-platform/orchestrator/context_builder';
import {
  preserve_compaction_anchors,
  start_background_session_compaction,
} from '@runtime-platform/session_harness/session_compaction';
import {
  find_summarized_until_message_id,
  type HarnessRunMessage,
  project_run_messages_to_pi_session_entries,
} from '@runtime-platform/session_harness/session_entries';
import { describe, expect, it } from 'vitest';

const forced_compaction_settings = {
  enabled: true,
  reserveTokens: 1_000_000_000,
  keepRecentTokens: 220,
};

describe('session harness projection', () => {
  it('projects Coworker messages into Pi session entries with a linear parent chain', () => {
    const projection = project_run_messages_to_pi_session_entries({
      messages: [
        message('m1', 'user', 'first request'),
        hidden_message('hidden', 'user', 'poison'),
        message('m2', 'assistant', 'first answer'),
        message('m3', 'tool_result', 'tool output'),
      ],
    });

    expect(projection.entries.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
    expect(projection.entries.map((entry) => entry.parentId)).toEqual([null, 'm1', 'm2']);
  });

  it('turns an existing Coworker summary into a Pi compaction entry', () => {
    const projection = project_run_messages_to_pi_session_entries({
      messages: [
        message('m1', 'user', 'old request'),
        message('m2', 'assistant', 'old answer'),
        multimodal_message('m3', 'user', 'what is in this image?'),
        message('m4', 'assistant', 'new answer'),
      ],
      context_summary: 'Earlier summary from Pi.',
      summarized_until_message_id: 'm2',
    });

    expect(projection.entries[0]).toMatchObject({
      type: 'compaction',
      id: 'compaction:m2',
      summary: 'Earlier summary from Pi.',
      firstKeptEntryId: 'm3',
    });
    expect(projection.entries.map((entry) => entry.id)).toEqual(['compaction:m2', 'm3', 'm4']);
  });

  it('keeps the previous summary boundary when a new compaction keeps the first fresh message', () => {
    const projection = project_run_messages_to_pi_session_entries({
      messages: [
        message('m1', 'user', 'old request'),
        message('m2', 'assistant', 'old answer'),
        message('m3', 'user', 'fresh request'),
        message('m4', 'assistant', 'fresh answer'),
      ],
      context_summary: 'Earlier summary from Pi.',
      summarized_until_message_id: 'm2',
    });

    expect(
      find_summarized_until_message_id({
        entries: projection.entries,
        first_kept_entry_id: 'm3',
        previous_summarized_until_message_id: 'm2',
      }),
    ).toBe('m2');
  });
});

describe('session harness compaction benchmark', () => {
  it('uses Pi cut-point logic and produces a smaller future context', () => {
    const messages = long_session_messages();
    const projection = project_run_messages_to_pi_session_entries({ messages });
    const plan = prepare_pi_compaction({
      entries: projection.entries,
      model: { model_provider: 'openai', model_name: 'gpt-5.5', reasoning_level: 'medium' },
      settings: forced_compaction_settings,
    });

    expect(plan.status).toBe('prepared');
    if (plan.status !== 'prepared') return;

    const summarized_until_message_id = find_summarized_until_message_id({
      entries: projection.entries,
      first_kept_entry_id: plan.preparation.firstKeptEntryId,
    });
    const after_context = build_session_context_from_messages({
      workspace_id: 'wrk_1',
      session_id: 'ses_1',
      system_instructions: 'Build reliably.',
      context_summary: benchmark_summary(plan.preparation.messagesToSummarize.length),
      context_summary_source: 'pi_agent_harness.compaction',
      summarized_until_message_id,
      recent_message_limit: 100,
      recent_token_budget: 100_000,
      messages,
    });
    const after_tokens =
      after_context.selection_policy.selected_token_estimate +
      after_context.context_packets.reduce((total, packet) => total + packet.token_count, 0);

    expect(plan.context_tokens).toBeGreaterThan(after_tokens);
    expect(after_context.context_management).toMatchObject({
      summary_source: 'pi_agent_harness.compaction',
      engine_compaction: 'pi_agent_harness_compaction',
      hidden_compaction_allowed: false,
    });
    expect(after_context.messages.at(-2)?.run_message_id).toBe('image-question');
  });

  it('preserves the first visible user message as a deterministic compaction anchor', () => {
    const summary = preserve_compaction_anchors('## Goal\nKeep working.', [
      hidden_message('hidden', 'user', 'do not keep this'),
      message('m1', 'user', 'FIRST_MESSAGE_SENTINEL: keep exactly'),
      message('m2', 'assistant', 'ack'),
    ]);

    expect(summary).toContain('## Preserved Session Anchors');
    expect(summary).toContain('First user message id: m1');
    expect(summary).toContain('FIRST_MESSAGE_SENTINEL: keep exactly');
    expect(summary).not.toContain('do not keep this');
  });
});

describe('background session compaction', () => {
  const background_model = { model_provider: 'anthropic', model_name: 'claude-opus-4-5' };

  it('reads the live session and leaves a session with nothing to summarize alone', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    await start_background_session_compaction(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: 'run_background',
      model: background_model,
      actor_id: bootstrap.user_id,
    });

    const after = await get_session(db, bootstrap.workspace_id, session.session_id);
    expect(after?.context_summary).toBeNull();
    expect(after?.summarized_until_message_id).toBeNull();
  });

  it('skips a second run while one is in flight and resolves when the database fails', async () => {
    let session_reads = 0;
    let fail_the_session_read = () => {};
    const failing_db = {
      query: {
        sessions: {
          findFirst: () => {
            session_reads += 1;
            return new Promise((_resolve, reject) => {
              fail_the_session_read = () => reject(new Error('database unavailable'));
            });
          },
        },
      },
    } as unknown as Database;
    const background_input = {
      workspace_id: 'workspace_background',
      session_id: 'session_background',
      run_id: 'run_background',
      model: background_model,
      actor_id: 'user_background',
    };

    const first = start_background_session_compaction(failing_db, background_input);
    const second = start_background_session_compaction(failing_db, background_input);
    expect(session_reads).toBe(1);

    fail_the_session_read();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    const third = start_background_session_compaction(failing_db, background_input);
    expect(session_reads).toBe(2);
    fail_the_session_read();
    await expect(third).resolves.toBeUndefined();
  });
});

function long_session_messages(): HarnessRunMessage[] {
  return [
    ...Array.from({ length: 24 }, (_, index) =>
      message(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', repeated_text(index)),
    ),
    multimodal_message('image-question', 'user', 'Use the attached screenshot in the next step.'),
    message('latest-answer', 'assistant', 'I will keep the screenshot available.'),
  ];
}

function benchmark_summary(message_count: number) {
  return [
    '## Goal',
    'Preserve the completed earlier work.',
    '',
    '## Progress',
    `Compacted ${message_count} earlier model-visible messages using Pi cut-point logic.`,
  ].join('\n');
}

function repeated_text(index: number) {
  return `turn ${index} ${'context detail '.repeat(60)}`;
}

function message(run_message_id: string, message_role: string, text: string): HarnessRunMessage {
  return {
    run_message_id,
    message_role,
    message_sequence: Number(run_message_id.replace(/\D/g, '')) || 1,
    message_content: { type: 'text', text },
  };
}

function hidden_message(run_message_id: string, message_role: string, text: string) {
  return { ...message(run_message_id, message_role, text), is_model_visible: false };
}

function multimodal_message(
  run_message_id: string,
  message_role: string,
  text: string,
): HarnessRunMessage {
  return {
    run_message_id,
    message_role,
    message_sequence: 100,
    message_content: {
      type: 'multimodal',
      text,
      parts: [
        { type: 'text', text },
        { type: 'image', data: 'a'.repeat(8_000), mime_type: 'image/png' },
      ],
    },
  };
}
