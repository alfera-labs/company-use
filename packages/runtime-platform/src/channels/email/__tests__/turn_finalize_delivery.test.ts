import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { runs, tool_calls } from '@coworker/core/db/schema';
import type { TrustedEmailTurnContext } from '@runtime-platform/channels/email/event_payloads';
import { finalize_email_channel_turn } from '@runtime-platform/channels/email/turn_finalize';
import { afterEach, describe, expect, it, vi } from 'vitest';

const turn: TrustedEmailTurnContext = {
  email_id: 'em_1',
  workspace_address: 'acme@inbox.test.alfera.ai',
  reply_to_email: 'ada@example.com',
  reply_cc: [],
  reply_expected: true,
  subject: 'Weekly update',
  message_id: '<msg-1@example.com>',
};

async function seed_run(db: Database, run_status: string) {
  const [run] = await db
    .insert(runs)
    .values({
      run_id: `run_${Math.random().toString(36).slice(2, 10)}`,
      workspace_id: 'ws_finalize',
      session_id: 'sess_1',
      agent_id: 'agent_1',
      run_status,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!run) throw new Error('run seed failed');
  return run;
}

function finalize_input(run: { run_id: string; run_status: string }) {
  return {
    workspace_id: 'ws_finalize',
    session_id: 'ses_test',
    run_id: run.run_id,
    run_status: run.run_status,
    turn,
    actor_id: 'system:email',
    finalized_by: 'test',
  };
}

describe('finalize_email_channel_turn delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends exactly one closing email — the second finalize loses the claim', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/emails')
        ? new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 })
        : new Response(JSON.stringify({ id: 'sent_1', message_id: '<stamped@resend>' }), {
            status: 200,
          }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const run = await seed_run(db, 'completed');

    const first = await finalize_email_channel_turn(db, finalize_input(run));
    const second = await finalize_email_channel_turn(db, finalize_input(run));

    expect(first.outcome).toBe('sent_unresolved_notice');
    expect(second.outcome).toBe('already_finalized');
    const sends = fetch_mock.mock.calls.filter(([url]) => String(url).endsWith('/emails'));
    expect(sends).toHaveLength(1);
  });

  it('stands down when the agent already replied with email-respond-1', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const run = await seed_run(db, 'completed');
    await db.insert(tool_calls).values({
      tool_call_id: 'tc_1',
      workspace_id: 'ws_finalize',
      session_id: 'sess_1',
      run_id: run.run_id,
      tool_name: 'email-respond-1',
      tool_status: 'completed',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });

    const result = await finalize_email_channel_turn(db, finalize_input(run));

    expect(result.outcome).toBe('resolved_by_agent');
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('sends an honest failure notice for a failed run', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetch_mock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const run = await seed_run(db, 'failed');

    const result = await finalize_email_channel_turn(db, finalize_input(run));

    expect(result.outcome).toBe('sent_run_failure_notice');
    const [, init] = fetch_mock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).text).toContain('Something went wrong');
  });

  it('closes the turn as send_failed when the provider is down, never throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 503 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await create_test_database();
    const run = await seed_run(db, 'completed');

    const result = await finalize_email_channel_turn(db, finalize_input(run));

    expect(result.outcome).toBe('send_failed');
    vi.restoreAllMocks();
  });
});
