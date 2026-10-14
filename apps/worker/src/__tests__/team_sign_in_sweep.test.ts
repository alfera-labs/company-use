import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { team_sessions, team_sign_in_links } from '@coworker/core/db/schema';
import { sweep_finished_team_sign_ins } from '@worker/team_sign_in_sweep';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hour_ms = 60 * 60 * 1000;
const who = {
  workspace_id: 'ws_1',
  user_id: 'user_1',
  created_by: 'user_1',
  last_updated_by: 'user_1',
};

async function store_links_and_sessions(db: Database) {
  const later = new Date(Date.now() + hour_ms);
  const earlier = new Date(Date.now() - hour_ms);
  await db.insert(team_sign_in_links).values([
    { ...who, token_hash: 'open link', expires_time: later },
    { ...who, token_hash: 'used link', expires_time: later, used_time: earlier },
    { ...who, token_hash: 'expired link', expires_time: earlier },
  ]);
  await db.insert(team_sessions).values([
    { ...who, session_hash: 'live session', expires_time: later },
    { ...who, session_hash: 'expired session', expires_time: earlier },
  ]);
}

async function stored_keys(db: Database) {
  const [links, sessions] = await Promise.all([
    db.select().from(team_sign_in_links),
    db.select().from(team_sessions),
  ]);
  return [...links.map((link) => link.token_hash), ...sessions.map((s) => s.session_hash)].sort();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the sweep of finished team sign-ins', () => {
  it('removes used and expired links and expired sessions, and keeps what still works', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    const db = await create_test_database();
    await store_links_and_sessions(db);

    await sweep_finished_team_sign_ins(db);

    expect(await stored_keys(db)).toEqual(['live session', 'open link']);
  });

  it('touches nothing on an install that is not in team mode', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const db = await create_test_database();
    await store_links_and_sessions(db);

    await sweep_finished_team_sign_ins(db);

    expect(await stored_keys(db)).toHaveLength(5);
  });
});
