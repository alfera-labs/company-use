import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { agents, sessions, workspaces } from '@coworker/core/db/schema';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { find_or_create_email_thread_session } from '@runtime-platform/channels/email/thread_sessions';
import { describe, expect, it } from 'vitest';

async function seed_workspace_with_agent(db: Database) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Acme',
      workspace_slug: 'acme-threads',
      inbound_email_username: 'acme',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  const [agent] = await db
    .insert(agents)
    .values({
      agent_id: 'agent_threads_1',
      workspace_id: workspace.workspace_id,
      agent_name: 'Main',
      system_prompt: 'x',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!agent) throw new Error('agent seed failed');
  return { workspace, agent };
}

function email(overrides: Partial<InboundEmailMessage>): InboundEmailMessage {
  return {
    email_id: 'em_x',
    from: 'Ada <ada@example.com>',
    from_email: 'ada@example.com',
    to: ['acme@inbox.test.alfera.ai'],
    cc: [],
    subject: 'Weekly update',
    body_text: 'body',
    attachment_names: [],
    sender_authentication: { dmarc: 'pass' as const, spf: 'pass' as const, dkim: 'pass' as const },
    ...overrides,
  };
}

function thread_input(
  seeded: Awaited<ReturnType<typeof seed_workspace_with_agent>>,
  message: InboundEmailMessage,
  member_emails: string[] = [],
) {
  return {
    workspace_id: seeded.workspace.workspace_id,
    default_agent_id: seeded.agent.agent_id,
    workspace_address: 'acme@inbox.test.alfera.ai',
    message,
    member_emails,
    actor_id: 'system:email',
  };
}

async function seed_sending_session(
  db: Database,
  seeded: Awaited<ReturnType<typeof seed_workspace_with_agent>>,
  session_id: string,
) {
  const [session] = await db
    .insert(sessions)
    .values({
      session_id,
      workspace_id: seeded.workspace.workspace_id,
      agent_id: seeded.agent.agent_id,
      session_source: 'dashboard',
      source_type: 'dashboard',
      source_metadata: {
        email: {
          participants: ['vendor@example.com'],
          sent_message_ids: ['<agent-sent@inbox.test.alfera.ai>'],
        },
      },
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!session) throw new Error('session seed failed');
  return session;
}

describe('find_or_create_email_thread_session', () => {
  it('keeps a reply from a DIFFERENT participant in the same session via the References chain', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({ email_id: 'em_1', message_id: '<root@example.com>', cc: ['bob@example.com'] }),
      ),
    );
    const reply_from_new_person = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          from: 'Bob <bob@example.com>',
          from_email: 'bob@example.com',
          subject: 'Re: Weekly update',
          message_id: '<reply-1@example.com>',
          in_reply_to: '<root@example.com>',
          references: ['<root@example.com>', '<reply-1@example.com>'],
        }),
      ),
    );

    expect(reply_from_new_person.session_id).toBe(original.session_id);
  });

  it('refuses to join a session for a sender who was never on the thread (forged References)', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_1', message_id: '<root@example.com>' })),
    );
    const hijack_attempt = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          from: 'Mallory <mallory@evil.example>',
          from_email: 'mallory@evil.example',
          message_id: '<forged@evil.example>',
          references: ['<root@example.com>', '<forged@evil.example>'],
        }),
      ),
    );

    expect(hijack_attempt.session_id).not.toBe(original.session_id);
  });

  it('lets a workspace member join any thread and anchors reply-all on member presence', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);
    const member_emails = ['owner@acme.com'];

    const stranger_thread = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({ email_id: 'em_1', message_id: '<root@example.com>', cc: ['carol@example.com'] }),
        member_emails,
      ),
    );
    expect(stranger_thread.has_member_participant).toBe(false);

    const member_reply = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          from: 'Owner <owner@acme.com>',
          from_email: 'owner@acme.com',
          message_id: '<owner-reply@example.com>',
          references: ['<root@example.com>', '<owner-reply@example.com>'],
        }),
        member_emails,
      ),
    );

    expect(member_reply.session_id).toBe(stranger_thread.session_id);
    expect(member_reply.has_member_participant).toBe(true);
  });

  it('refuses to join a thread when a MEMBER address failed sender authentication', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);
    const member_emails = ['owner@acme.com'];

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({ email_id: 'em_1', message_id: '<root@example.com>' }),
        member_emails,
      ),
    );
    const forged_member = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          from: 'Owner <owner@acme.com>',
          from_email: 'owner@acme.com',
          message_id: '<forged-member@evil.example>',
          references: ['<root@example.com>', '<forged-member@evil.example>'],
          sender_authentication: { dmarc: 'fail', spf: 'fail', dkim: 'none' },
        }),
        member_emails,
      ),
    );

    expect(forged_member.session_id).not.toBe(original.session_id);
    expect(forged_member.has_member_participant).toBe(false);
  });

  it('does NOT merge a brand-new email that reuses an old subject', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const first = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_1', message_id: '<a@example.com>' })),
    );
    const unrelated_same_subject = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_2', message_id: '<b@example.com>' })),
    );

    expect(unrelated_same_subject.session_id).not.toBe(first.session_id);
  });

  it('opens a NEW session for a forward (fresh Message-ID, no References)', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_1', message_id: '<root@example.com>' })),
    );
    const forwarded = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          subject: 'Fwd: Weekly update',
          message_id: '<forward@example.com>',
        }),
      ),
    );

    expect(forwarded.session_id).not.toBe(original.session_id);
  });

  it('follows the thread through a subject rename because headers still chain', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_1', message_id: '<root@example.com>' })),
    );
    const renamed = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          subject: 'Totally different subject',
          message_id: '<reply@example.com>',
          references: ['<root@example.com>', '<reply@example.com>'],
        }),
      ),
    );

    expect(renamed.session_id).toBe(original.session_id);
  });

  it('accumulates participants as people join, excluding managed-domain addresses', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const original = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({ email_id: 'em_1', message_id: '<root@example.com>', cc: ['carol@example.com'] }),
      ),
    );
    expect(original.participants.sort()).toEqual(['ada@example.com', 'carol@example.com']);

    const reply_adding_people = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_2',
          from: 'Ada <ada@example.com>',
          from_email: 'ada@example.com',
          message_id: '<reply@example.com>',
          references: ['<root@example.com>', '<reply@example.com>'],
          to: ['acme@inbox.test.alfera.ai', 'bob@example.com'],
          cc: ['dave@example.com', 'other-agent@inbox.test.alfera.ai'],
        }),
      ),
    );

    expect(reply_adding_people.session_id).toBe(original.session_id);
    expect(reply_adding_people.participants.sort()).toEqual([
      'ada@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
  });

  it('routes a reply back into the conversation that sent it, across channels', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);
    await seed_sending_session(db, seeded, 'ses_dash_1');

    const answer = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_answer',
          from: 'Vendor <vendor@example.com>',
          from_email: 'vendor@example.com',
          subject: 'Re: Quick question',
          message_id: '<vendor-answer@example.com>',
          in_reply_to: '<agent-sent@inbox.test.alfera.ai>',
          references: ['<agent-sent@inbox.test.alfera.ai>'],
        }),
      ),
    );

    expect(answer.session_id).toBe('ses_dash_1');
    expect(answer.session_source).toBe('dashboard');
  });

  it('refuses that route for someone who is not on the conversation', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);
    await seed_sending_session(db, seeded, 'ses_dash_2');

    const intruder = await find_or_create_email_thread_session(
      db,
      thread_input(
        seeded,
        email({
          email_id: 'em_intruder',
          from: 'Mallory <mallory@evil.example>',
          from_email: 'mallory@evil.example',
          message_id: '<intruder@evil.example>',
          in_reply_to: '<agent-sent@inbox.test.alfera.ai>',
        }),
      ),
    );

    expect(intruder.session_id).not.toBe('ses_dash_2');
    expect(intruder.session_source).toBe('email');
  });

  it('threads by sender+subject when an email carries no usable message ids', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace_with_agent(db);

    const first = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_1' })),
    );
    const second = await find_or_create_email_thread_session(
      db,
      thread_input(seeded, email({ email_id: 'em_2', subject: 'Re: Weekly update' })),
    );

    expect(second.session_id).toBe(first.session_id);
  });
});
