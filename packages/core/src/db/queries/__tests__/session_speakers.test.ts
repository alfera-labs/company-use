import { randomUUID } from 'node:crypto';
import { build_participants } from '@coworker/core/access/build_participants';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import { create_database } from '@coworker/core/db/connection';
import { replace_resource_sharing } from '@coworker/core/db/queries/resource_grants';
import { set_session_read_marker } from '@coworker/core/db/queries/session_read_markers';
import { record_platform_user_as_speaker } from '@coworker/core/db/queries/session_speakers';
import { get_session } from '@coworker/core/db/queries/sessions';
import { agents, sessions, users, workspaces } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error(
    'COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not — the session speaker test cannot run',
  );
}

const suffix = randomUUID().slice(0, 8);
const workspace_id = `ws_speaker_${suffix}`;
const user_id = `user_speaker_${suffix}`;
const agent_id = `agt_speaker_${suffix}`;
const session_id = `ses_speaker_${suffix}`;
const connection_id = `conn_speaker_${suffix}`;
const actor_id = 'system:session_speakers_test';

const db = database_url ? create_database(database_url) : undefined;

beforeAll(async () => {
  if (!db) return;
  await db.insert(workspaces).values({
    workspace_id,
    workspace_name: 'Speaker test',
    workspace_slug: `speaker-test-${suffix}`,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(users).values({
    user_id,
    email: `speaker-${suffix}@example.test`,
    first_name: 'Ada',
    last_name: 'Lovelace',
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(agents).values({
    agent_id,
    workspace_id,
    agent_name: 'Speaker test coworker',
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await db.insert(sessions).values({
    session_id,
    workspace_id,
    agent_id,
    session_source: 'dashboard',
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  await replace_resource_sharing(db, {
    workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    shared_with: [{ grantee_type: 'user', grantee_id: user_id, grant_level: 'manage' }],
    actor_id,
  });
});

afterAll(async () => {
  if (!db) return;
  await db.delete(sessions).where(eq(sessions.workspace_id, workspace_id));
  await db.delete(agents).where(eq(agents.workspace_id, workspace_id));
  await db.delete(workspaces).where(eq(workspaces.workspace_id, workspace_id));
  await db.delete(users).where(eq(users.user_id, user_id));
  await replace_resource_sharing(db, {
    workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    shared_with: [],
    actor_id,
  });
});

async function ask_the_gate() {
  if (!db) throw new Error('no database');
  const session = await get_session(db, workspace_id, session_id);
  if (!session) throw new Error('session missing');
  return check_resource_use(db, {
    workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    participants: build_participants({
      project_id: session.project_id,
      session_metadata: session.session_metadata,
      session_source_metadata: session.source_metadata,
      agent_ids: [session.agent_id],
    }),
  });
}

describe.skipIf(!database_url)('a signed-in surface recording its speaker', () => {
  it('refuses the owner their own connection while no speaker is recorded', async () => {
    expect(await ask_the_gate()).toMatchObject({
      allowed: false,
      denial_reason: 'nobody_present_to_check',
      blocked_grantee_type: 'user',
    });
  });

  it('records the speaker with a display name for attribution', async () => {
    if (!db) return;
    await record_platform_user_as_speaker(db, { workspace_id, session_id, user_id });

    const session = await get_session(db, workspace_id, session_id);
    expect(session?.session_metadata.actors).toMatchObject([
      {
        source_actor_id: `platform:${user_id}`,
        actor_kind: 'platform_user',
        platform_user_id: user_id,
        profile: { display_name: 'Ada Lovelace', email: `speaker-${suffix}@example.test` },
      },
    ]);
  });

  it('lets the owner use their own connection once recorded', async () => {
    expect(await ask_the_gate()).toEqual({ allowed: true, grant_level: 'manage' });
  });

  it('counts the same person once across turns', async () => {
    if (!db) return;
    await record_platform_user_as_speaker(db, { workspace_id, session_id, user_id });

    const session = await get_session(db, workspace_id, session_id);
    expect(session?.session_metadata.actors).toHaveLength(1);
    expect(session?.session_metadata.actors?.[0]?.message_count).toBe(2);
  });

  it('reports a missing session as not found', async () => {
    if (!db) return;
    await expect(
      record_platform_user_as_speaker(db, {
        workspace_id,
        session_id: 'ses_does_not_exist',
        user_id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('recording a speaker beside a concurrent read marker', () => {
  it('keeps a read marker that landed between the read and the write', async () => {
    if (!db) return;
    await set_session_read_marker(db, {
      workspace_id,
      session_id,
      reader_id: user_id,
      last_read_sequence: 7,
    });
    await record_platform_user_as_speaker(db, { workspace_id, session_id, user_id });

    const session = await get_session(db, workspace_id, session_id);
    expect(session?.session_metadata.read_markers).toMatchObject({ [user_id]: 7 });
    expect(session?.session_metadata.actors?.length).toBeGreaterThan(0);
  });
});
