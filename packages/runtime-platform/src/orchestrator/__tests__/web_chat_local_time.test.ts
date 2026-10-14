import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_user_timezone } from '@coworker/core/db/queries/user_timezone';
import { get_user } from '@coworker/core/db/queries/users';
import { format_current_turn_context } from '@runtime-platform/orchestrator/context/current_turn_context';
import { build_model_visible_current_turn_context } from '@runtime-platform/orchestrator/current_turn_context';
import { afterEach, describe, expect, it, vi } from 'vitest';

const web_chat_turn = { session_id: 'ses_chat', source_type: 'dashboard' as const };
const speaker = { name: 'Robin Tate', email: 'robin@example.com' };

afterEach(() => {
  vi.useRealTimers();
});

describe('the local time of the person in a web chat turn', () => {
  it('is told to the model when the person has a stored time zone', async () => {
    const person = await read_person_with_timezone('Asia/Tokyo');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'));

    const context = build_model_visible_current_turn_context(
      { ...web_chat_turn, read_actor_user: person },
      speaker,
    );
    const text = format_current_turn_context(context);

    expect(text).toMatch(
      /^speaker_local_time: Monday, January 12, 2026.* 21:00 \(Asia\/Tokyo\)$/mu,
    );
    expect(text).toContain('Use this wall-clock time for any date or time answer, not UTC.');
  });

  it('leaves the web chat context as it was when no time zone is stored', async () => {
    const person = await read_person_with_timezone(null);

    const with_person = format_current_turn_context(
      build_model_visible_current_turn_context(
        { ...web_chat_turn, read_actor_user: person },
        speaker,
      ),
    );
    const without_person = format_current_turn_context(
      build_model_visible_current_turn_context(web_chat_turn, speaker),
    );

    expect(with_person).toBe(without_person);
    expect(with_person).not.toContain('speaker_local_time');
    expect(with_person).not.toContain('wall-clock');
  });
});

async function read_person_with_timezone(timezone: string | null) {
  const db = await create_test_database();
  const person = await bootstrap_default_workspace(db);
  if (timezone) {
    await set_user_timezone(db, { user_id: person.user_id, timezone, actor_id: person.user_id });
  }
  const user = await get_user(db, person.user_id);
  if (!user) throw new Error('The test person was not created');
  return user;
}
