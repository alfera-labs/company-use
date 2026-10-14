import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import type { TrustedEmailTurnContext } from '@runtime-platform/channels/email/event_payloads';
import { send_email_turn_reply } from '@runtime-platform/channels/email/turn_reply';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const send_email_reply = vi.fn(async (_input: { references?: string[] }) => ({ id: 'sent_1' }));

vi.mock('@runtime-platform/channels/email/resend_api', () => ({
  send_email_reply: (input: { references?: string[] }) => send_email_reply(input),
  fetch_sent_email_message_id: vi.fn(async () => null),
}));

let db: Database;
let workspace_id: string;

beforeAll(async () => {
  db = await create_test_database();
  workspace_id = (await bootstrap_default_workspace(db)).workspace_id;
});

function turn(overrides: Partial<TrustedEmailTurnContext> = {}): TrustedEmailTurnContext {
  return {
    workspace_address: 'agent@inbox.example.com',
    reply_to_email: 'person@example.com',
    reply_cc: [],
    subject: 'Q3 budget file',
    ...overrides,
  } as TrustedEmailTurnContext;
}

async function references_of(context: TrustedEmailTurnContext): Promise<string[] | undefined> {
  await send_email_turn_reply(db, workspace_id, context, 'body');
  return send_email_reply.mock.calls.at(-1)?.[0]?.references;
}

beforeEach(() => {
  send_email_reply.mockClear();
});

describe('reply threading headers', () => {
  it('seeds References with the parent id when replying to a first email', async () => {
    expect(await references_of(turn({ message_id: '<first@mail.gmail.com>' }))).toEqual([
      '<first@mail.gmail.com>',
    ]);
  });

  it('appends the parent id to an existing chain', async () => {
    const context = turn({
      message_id: '<third@mail.gmail.com>',
      references: ['<first@mail.gmail.com>', '<second@ses.amazonaws.com>'],
    });
    expect(await references_of(context)).toEqual([
      '<first@mail.gmail.com>',
      '<second@ses.amazonaws.com>',
      '<third@mail.gmail.com>',
    ]);
  });

  it('does not repeat an id the chain already carries', async () => {
    const context = turn({
      message_id: '<second@mail.gmail.com>',
      references: ['<first@mail.gmail.com>', '<second@mail.gmail.com>'],
    });
    expect(await references_of(context)).toEqual([
      '<first@mail.gmail.com>',
      '<second@mail.gmail.com>',
    ]);
  });

  it('keeps the thread root when a long chain is trimmed', async () => {
    const long_chain = Array.from({ length: 40 }, (_, index) => `<m${index}@example.com>`);
    const references = await references_of(
      turn({ message_id: '<latest@example.com>', references: long_chain }),
    );
    expect(references).toHaveLength(20);
    expect(references?.[0]).toBe('<m0@example.com>');
    expect(references?.at(-1)).toBe('<latest@example.com>');
  });

  it('sends no References header when there is nothing to reference', async () => {
    expect(await references_of(turn())).toBeUndefined();
  });
});
