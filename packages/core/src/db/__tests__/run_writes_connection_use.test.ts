import { randomUUID } from 'node:crypto';
import { open_counted_database } from '@coworker/core/db/__tests__/counted_database';
import { create_run_events, create_run_message } from '@coworker/core/db/queries/sessions';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error('COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not');
}

const test_workspace_id = 'ws_connection_use_test';
const counted_databases: ReturnType<typeof open_counted_database>[] = [];

afterAll(async () => {
  if (!database_url) return;
  const cleanup = postgres(database_url, { max: 1, prepare: false });
  await cleanup`DELETE FROM run_events WHERE workspace_id = ${test_workspace_id}`;
  await cleanup`DELETE FROM run_messages WHERE workspace_id = ${test_workspace_id}`;
  await cleanup`DELETE FROM sessions WHERE workspace_id = ${test_workspace_id}`;
  await cleanup.end();
  await Promise.all(counted_databases.map((counted) => counted.close()));
});

describe.skipIf(!database_url)(
  'pooled connections one run or one search holds at once (needs real Postgres)',
  () => {
    it('writes parallel event batches for one run through one connection at a time', async () => {
      const counted = open_test_database();
      const run_id = `run_connection_use_${randomUUID()}`;

      const batches = await Promise.all(
        Array.from({ length: 8 }, () =>
          create_run_events(counted.db, {
            workspace_id: test_workspace_id,
            session_id: 'ses_connection_use_test',
            run_id,
            actor_id: 'system:test',
            events: [{ event_type: 'progress' }, { event_type: 'progress' }],
          }),
        ),
      );

      const sequences = batches.flat().map((row) => row.event_sequence);
      expect(sequences.sort((left, right) => left - right)).toEqual(
        Array.from({ length: 16 }, (_, index) => index + 1),
      );
      expect(counted.most_in_use()).toBe(1);
    });

    it('writes parallel messages for one session through one connection at a time', async () => {
      const counted = open_test_database();
      const session_id = `ses_connection_use_${randomUUID()}`;
      const run_id = `run_connection_use_${randomUUID()}`;
      await create_session_row(session_id);

      await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          create_run_message(counted.db, {
            workspace_id: test_workspace_id,
            session_id,
            run_id,
            message_role: 'assistant',
            message_content: { type: 'text', text: `answer ${index}` },
            source_type: 'runtime',
            actor_id: 'system:test',
          }),
        ),
      );

      expect(counted.most_in_use()).toBe(1);
    });
  },
);

async function create_session_row(session_id: string) {
  const writer = postgres(database_url ?? '', { max: 1, prepare: false });
  await writer`
    INSERT INTO sessions (session_id, workspace_id, agent_id, created_by, last_updated_by)
    VALUES (${session_id}, ${test_workspace_id}, 'agt_connection_use_test', 'system:test', 'system:test')
  `;
  await writer.end();
}

function open_test_database() {
  const counted = open_counted_database(database_url ?? '', 8);
  counted_databases.push(counted);
  return counted;
}
