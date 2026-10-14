import { normalize_user_content } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { describe, expect, it } from 'vitest';

describe('what a run opens with', () => {
  it('opens a continuing run with nothing at all', () => {
    expect(normalize_user_content(run_input({ continues_session: true }))).toEqual([]);
  });

  it('still refuses an ordinary run with no message', () => {
    expect(() => normalize_user_content(run_input({}))).toThrow('User message content is required');
  });

  it('uses the message when a person did say something', () => {
    expect(normalize_user_content(run_input({ user_message: 'Send it' }))).toEqual([
      { type: 'text', text: 'Send it' },
    ]);
  });
});

function run_input(overrides: Record<string, unknown>) {
  return {
    workspace_id: 'ws_1',
    session_id: 'ses_1',
    actor_id: 'user_1',
    ...overrides,
  } as Parameters<typeof normalize_user_content>[0];
}
