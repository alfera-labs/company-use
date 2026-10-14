import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  list_run_messages,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { finalize_slack_channel_turn } from '@runtime-platform/channels/slack/turn_finalize';
import type { SlackTurnSynthesisInput } from '@runtime-platform/channels/slack/turn_synthesis';
import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';

describe('Slack final synthesis', () => {
  it('lets only the claim winner synthesize, post, and persist a raced reply', async () => {
    const arranged = await arrange_unresolved_turn();
    const api_call = vi.fn().mockResolvedValue({ ok: true, ts: '1700000000.0002' });
    const synthesize_reply = vi.fn().mockResolvedValue('The launch brief is verified.');
    const input = build_finalize_input(arranged, api_call, synthesize_reply);

    const results = await Promise.all([
      finalize_slack_channel_turn(arranged.db, input),
      finalize_slack_channel_turn(arranged.db, input),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'already_finalized',
      'delivered_recovered_reply',
    ]);
    expect(synthesize_reply).toHaveBeenCalledOnce();
    expect(api_call).toHaveBeenCalledOnce();
    expect(
      await list_run_messages(arranged.db, arranged.workspace_id, arranged.run_id),
    ).toHaveLength(1);
  });

  it('posts the honest notice when synthesis throws', async () => {
    const arranged = await arrange_unresolved_turn();
    const api_call = vi.fn().mockResolvedValue({ ok: true, ts: '1700000000.0002' });
    const input = build_finalize_input(arranged, api_call, async () => {
      throw new Error('llm gateway timeout');
    });

    const result = await finalize_slack_channel_turn(arranged.db, input);

    expect(result.outcome).toBe('posted_unresolved_notice');
    expect(api_call).toHaveBeenCalledWith(
      'chat.postMessage',
      expect.objectContaining({ text: expect.stringContaining("couldn't post a reply") }),
    );
    expect(
      await list_run_messages(arranged.db, arranged.workspace_id, arranged.run_id),
    ).toHaveLength(0);
  });

  it('does not persist a synthesized reply that Slack rejected', async () => {
    const arranged = await arrange_unresolved_turn();
    const api_call = vi
      .fn()
      .mockRejectedValueOnce(new Error('channel_not_found'))
      .mockResolvedValue({ ok: true, ts: '1700000000.0003' });
    const input = build_finalize_input(
      arranged,
      api_call,
      async () => 'The launch brief is verified.',
    );

    const result = await finalize_slack_channel_turn(arranged.db, input);

    expect(result.outcome).toBe('posted_unresolved_notice');
    expect(api_call).toHaveBeenCalledTimes(2);
    expect(
      await list_run_messages(arranged.db, arranged.workspace_id, arranged.run_id),
    ).toHaveLength(0);
  });
});

async function arrange_unresolved_turn() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_title: 'Post-tool synthesis',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'slack_event',
    actor_id: bootstrap.user_id,
  });
  await update_run_status(db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: bootstrap.user_id,
  });
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    actor_id: bootstrap.user_id,
    session_id: session.session_id,
    run_id: run.run_id,
  };
}

function build_finalize_input(
  arranged: Awaited<ReturnType<typeof arrange_unresolved_turn>>,
  api_call: ReturnType<typeof vi.fn>,
  synthesize_reply: (input: SlackTurnSynthesisInput) => Promise<string | null>,
) {
  return {
    slack_api: { apiCall: api_call } as unknown as WebClient,
    workspace_id: arranged.workspace_id,
    run_id: arranged.run_id,
    run_status: 'completed',
    channel_id: 'C123',
    thread_ts: '1700000000.0001',
    actor_id: arranged.actor_id,
    finalized_by: 'test',
    synthesize_reply,
    evidence_readers: {
      list_tool_calls: async () => [
        {
          tool_name: 'google_docs/get_document',
          tool_status: 'completed',
          output_data: { verified: true },
        },
      ],
      list_messages: async () => [
        {
          session_id: arranged.session_id,
          message_role: 'user',
          message_kind: 'input',
          is_user_visible: true,
          content_text: 'Create and verify the launch brief.',
          created_time: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      list_files: async () => [],
    },
  };
}
