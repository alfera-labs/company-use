import {
  as_person,
  call,
  db,
  invite_and_join,
  sign_in,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { delete_expired_team_sessions } from '@coworker/core/db/queries/team_sessions';
import { team_sessions, workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

const refusal_schema = z.object({
  code: z.string(),
  details: z.object({ workspace_name: z.string() }).optional(),
});

async function owner_and_a_removed_member() {
  const owner = await sign_the_owner_in();
  const member = await invite_and_join(owner.user_id, 'Dana', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  const removal = `/v1/team/members/${member.user_id}`;
  expect((await call('DELETE', removal, as_person(owner.user_id))).status).toBe(200);
  return { owner, member, workspace_name: String(workspace.data.workspace_name) };
}

async function session_answer(session_token: string) {
  const answer = await sign_in('session', { session_token });
  return { status: answer.status, ...refusal_schema.parse(answer.error ?? { code: 'none' }) };
}

describe('the session of a person who was removed', () => {
  it('signs nobody in, and says that the person was removed and from which workspace', async () => {
    const team = await owner_and_a_removed_member();

    expect(await session_answer(team.member.session_token)).toEqual({
      status: 401,
      code: 'team_member_removed',
      details: { workspace_name: team.workspace_name },
    });
    expect((await call('GET', '/v1/workspace', as_person(team.member.user_id))).status).toBe(401);
  });

  it('says nothing of the kind for a token nobody ever had', async () => {
    await owner_and_a_removed_member();

    expect(await session_answer('a'.repeat(43))).toEqual({ status: 401, code: 'unauthorized' });
  });

  it('says nothing of the kind to a member who only signed out everywhere', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Dana', 'member');
    const signed_out = await call(
      'POST',
      '/v1/team/sign-out-everywhere',
      as_person(member.user_id),
    );
    expect(signed_out.status).toBe(200);

    expect((await session_answer(member.session_token)).code).toBe('unauthorized');
  });

  it('stays unusable even if the seat of that person became active again', async () => {
    const team = await owner_and_a_removed_member();
    await db
      .update(workspace_members)
      .set({ member_status: 'active' })
      .where(eq(workspace_members.user_id, team.member.user_id));

    expect((await session_answer(team.member.session_token)).status).toBe(401);
  });

  it('is forgotten when the session would have run out', async () => {
    const team = await owner_and_a_removed_member();
    await db
      .update(team_sessions)
      .set({ expires_time: new Date(Date.now() - 1000) })
      .where(eq(team_sessions.user_id, team.member.user_id));
    await delete_expired_team_sessions(db);

    expect((await session_answer(team.member.session_token)).code).toBe('unauthorized');
  });
});
