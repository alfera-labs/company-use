import {
  issue_run_stream_ticket,
  run_stream_ticket_lifetime_ms,
  verify_run_stream_ticket,
} from '@runtime-platform/chat_stream/run_stream_ticket';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scope = { key_scope: 'pool_a', workspace_id: 'ws_1', session_id: 'sess_1' };
const person = { ...scope, user_id: 'user_1' };
const issued_at = new Date('2026-09-26T10:00:00.000Z');

afterEach(() => vi.unstubAllEnvs());

function use_keys(current: string, fallbacks = '') {
  vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY', current);
  vi.stubEnv('COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS', fallbacks);
}

function refusal_of(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as { code: string; status: number; message: string };
  }
  throw new Error('Expected the ticket to be refused');
}

describe('run stream ticket', () => {
  it('opens the chat it was issued for, with the person in it', () => {
    use_keys('key-a');
    const { ticket, expires_time } = issue_run_stream_ticket(person, issued_at);

    expect(verify_run_stream_ticket(ticket, scope, issued_at)).toEqual({
      v: 2,
      ...person,
      exp: (issued_at.getTime() + run_stream_ticket_lifetime_ms) / 1000,
    });
    expect(expires_time).toBe('2026-09-26T10:05:00.000Z');
  });

  it('is refused once five minutes have passed', () => {
    use_keys('key-a');
    const { ticket } = issue_run_stream_ticket(person, issued_at);
    const just_before = new Date(issued_at.getTime() + run_stream_ticket_lifetime_ms - 1_000);
    const at_expiry = new Date(issued_at.getTime() + run_stream_ticket_lifetime_ms);

    expect(verify_run_stream_ticket(ticket, scope, just_before).user_id).toBe('user_1');
    expect(refusal_of(() => verify_run_stream_ticket(ticket, scope, at_expiry))).toMatchObject({
      code: 'run_stream_ticket_refused',
      status: 401,
      message: 'The live stream ticket expired.',
    });
  });

  it('is refused when a claim was changed after signing', () => {
    use_keys('key-a');
    const { ticket } = issue_run_stream_ticket(person, issued_at);
    const [body, signature] = ticket.split('.');
    const claims = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8'));
    const forged_body = Buffer.from(JSON.stringify({ ...claims, user_id: 'user_2' })).toString(
      'base64url',
    );

    for (const forged of [`${forged_body}.${signature}`, `${body}.x${signature}`, body ?? '']) {
      expect(refusal_of(() => verify_run_stream_ticket(forged, scope, issued_at))).toMatchObject({
        message: 'The live stream ticket is not valid.',
      });
    }
  });

  it('is refused for another session, another workspace or another key scope', () => {
    use_keys('key-a');
    const { ticket } = issue_run_stream_ticket(person, issued_at);
    const other_chats = [
      { ...scope, session_id: 'sess_2' },
      { ...scope, workspace_id: 'ws_2' },
      { ...scope, key_scope: 'pool_b' },
    ];

    for (const other_chat of other_chats) {
      expect(
        refusal_of(() => verify_run_stream_ticket(ticket, other_chat, issued_at)),
      ).toMatchObject({ message: 'The live stream ticket is for another chat.', status: 401 });
    }
  });

  it('still opens with the retired key after a key rotation, and not with a stranger key', () => {
    use_keys('key-a');
    const { ticket } = issue_run_stream_ticket(person, issued_at);

    use_keys('key-b', 'key-a');
    expect(verify_run_stream_ticket(ticket, scope, issued_at).user_id).toBe('user_1');

    use_keys('key-b');
    expect(refusal_of(() => verify_run_stream_ticket(ticket, scope, issued_at))).toMatchObject({
      message: 'The live stream ticket is not valid.',
    });
  });
});
