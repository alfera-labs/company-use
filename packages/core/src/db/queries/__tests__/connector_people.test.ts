import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ConnectorPersonRow,
  dedupe_connector_people,
  read_connector_people,
  upsert_connector_people,
} from '@coworker/core/db/queries/connector_people';
import { upsert_source_actor } from '@coworker/core/db/queries/source_actors';
import { source_actors } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

const workspace_id = 'ws_connector_people';
const other_workspace_id = 'ws_connector_people_other';
const actor_id = 'user_test';

function a_person(overrides: Partial<ConnectorPersonRow> = {}): ConnectorPersonRow {
  return {
    external_person_id: 'U01',
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    person_kind: 'member',
    ...overrides,
  };
}

async function read_source_actor_row(db: Database, external_id: string) {
  const [row] = await db
    .select()
    .from(source_actors)
    .where(
      and(eq(source_actors.workspace_id, workspace_id), eq(source_actors.external_id, external_id)),
    );
  return row;
}

describe('dedupe_connector_people', () => {
  it('keeps the last row seen for a duplicate external id', () => {
    const deduped = dedupe_connector_people([
      a_person({ display_name: 'Ada (first seen)' }),
      a_person({ display_name: 'Ada (last seen)' }),
    ]);
    expect(deduped).toEqual([a_person({ display_name: 'Ada (last seen)' })]);
  });
});

describe('upsert_connector_people and read_connector_people', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
  }, 30_000);

  it('stores a batch of people on source_actors with provider set to the app key', async () => {
    const written = await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [
        a_person(),
        a_person({ external_person_id: 'U02', person_kind: 'bot', email: undefined }),
      ],
    });
    expect(written).toBe(2);

    const { people, problems } = await read_connector_people(db, {
      workspace_id,
      app_key: 'slack',
    });
    expect(problems).toEqual([]);
    expect(people).toEqual(
      expect.arrayContaining([
        a_person(),
        {
          external_person_id: 'U02',
          display_name: 'Ada Lovelace',
          email: undefined,
          person_kind: 'bot',
        },
      ]),
    );
  });

  it('gives a new slack person the platform_user actor_kind, matching chat_speaker.ts', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person()],
    });
    const row = await read_source_actor_row(db, 'U01');
    expect(row?.actor_kind).toBe('platform_user');
  });

  it('gives a new non-slack person the external_user actor_kind', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'github',
      actor_id,
      people: [a_person()],
    });
    const row = await read_source_actor_row(db, 'U01');
    expect(row?.actor_kind).toBe('external_user');
  });

  it('never rewrites an existing chat-speaker row actor_kind, and merges person_kind into metadata', async () => {
    await upsert_source_actor(db, {
      workspace_id,
      provider: 'slack',
      external_id: 'U01',
      display_name: 'Ada from Slack',
      actor_id,
    });
    const before = await read_source_actor_row(db, 'U01');
    expect(before?.actor_kind).toBe('platform_user');

    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ display_name: 'Ada from the directory' })],
    });

    const after = await read_source_actor_row(db, 'U01');
    expect(after?.actor_kind).toBe('platform_user');
    expect(after?.metadata).toMatchObject({ person_kind: 'member' });

    const { people } = await read_connector_people(db, { workspace_id, app_key: 'slack' });
    expect(people).toEqual([a_person({ display_name: 'Ada from the directory' })]);
  });

  it('merges metadata on write instead of replacing it', async () => {
    const actor = await upsert_source_actor(db, {
      workspace_id,
      provider: 'slack',
      external_id: 'U01',
      display_name: 'Ada',
      actor_id,
    });
    await db
      .update(source_actors)
      .set({ metadata: { kept_key: 'kept_value' } })
      .where(eq(source_actors.source_actor_id, actor.source_actor_id));

    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person()],
    });

    const row = await read_source_actor_row(db, 'U01');
    expect(row?.metadata).toMatchObject({ kept_key: 'kept_value', person_kind: 'member' });
  });

  it('reports an unknown person_kind as a problem instead of a silent default', async () => {
    const actor = await upsert_source_actor(db, {
      workspace_id,
      provider: 'notion',
      external_id: 'N01',
      display_name: 'Odd row',
      actor_id,
    });
    await db
      .update(source_actors)
      .set({ metadata: { person_kind: 'not_a_real_kind' } })
      .where(eq(source_actors.source_actor_id, actor.source_actor_id));

    const { people, problems } = await read_connector_people(db, {
      workspace_id,
      app_key: 'notion',
    });
    expect(people).toEqual([]);
    expect(problems).toEqual([
      { source_actor_id: actor.source_actor_id, reason: 'unknown_person_kind' },
    ]);
  });

  it('moves the name when the same person is upserted twice with a rename', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ display_name: 'Ada' })],
    });
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ display_name: 'Ada Lovelace (renamed)' })],
    });

    const { people } = await read_connector_people(db, { workspace_id, app_key: 'slack' });
    expect(people).toHaveLength(1);
    expect(people[0]?.display_name).toBe('Ada Lovelace (renamed)');

    const rows = await db
      .select()
      .from(source_actors)
      .where(
        and(eq(source_actors.workspace_id, workspace_id), eq(source_actors.provider, 'slack')),
      );
    expect(rows).toHaveLength(1);
  });

  it('keeps the last entry when a batch upsert names one external id twice', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [
        a_person({ display_name: 'Ada (first in batch)' }),
        a_person({ display_name: 'Ada (last in batch)' }),
      ],
    });

    const { people } = await read_connector_people(db, { workspace_id, app_key: 'slack' });
    expect(people).toEqual([a_person({ display_name: 'Ada (last in batch)' })]);
  });

  it('filters by workspace_id so one workspace never sees another workspace people', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ external_person_id: 'U01' })],
    });
    await upsert_connector_people(db, {
      workspace_id: other_workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ external_person_id: 'U02' })],
    });

    const { people } = await read_connector_people(db, { workspace_id, app_key: 'slack' });
    expect(people.map((person) => person.external_person_id)).toEqual(['U01']);
  });

  it('filters by app_key so one app never sees another app on the same workspace', async () => {
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [a_person({ external_person_id: 'U01' })],
    });
    await upsert_connector_people(db, {
      workspace_id,
      app_key: 'github',
      actor_id,
      people: [a_person({ external_person_id: 'U01' })],
    });

    const { people: slack_people } = await read_connector_people(db, {
      workspace_id,
      app_key: 'slack',
    });
    const { people: github_people } = await read_connector_people(db, {
      workspace_id,
      app_key: 'github',
    });
    expect(slack_people).toHaveLength(1);
    expect(github_people).toHaveLength(1);
  });

  it('answers no rows written for an empty batch', async () => {
    const written = await upsert_connector_people(db, {
      workspace_id,
      app_key: 'slack',
      actor_id,
      people: [],
    });
    expect(written).toBe(0);
  });
});
