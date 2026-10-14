import type { Database } from '@coworker/core/db/connection';
import { source_actors } from '@coworker/core/db/schema';
import { create_id, id_prefixes, type SourceActor } from '@coworker/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

export type ConnectorPersonKind = 'bot' | 'guest' | 'member';

const person_kind_by_raw_value: ReadonlyMap<string, ConnectorPersonKind> = new Map([
  ['bot', 'bot'],
  ['guest', 'guest'],
  ['member', 'member'],
]);

/** One row of a connector app's people directory, independent of the connectors package
 * so packages/core names its own shape at this storage boundary. */
export type ConnectorPersonRow = {
  external_person_id: string;
  display_name: string | undefined;
  email: string | undefined;
  person_kind: ConnectorPersonKind;
};

export type UpsertConnectorPeopleInput = {
  workspace_id: string;
  app_key: string;
  actor_id: string;
  people: readonly ConnectorPersonRow[];
};

export type ConnectorPersonReadProblem = {
  source_actor_id: string;
  reason: 'unknown_person_kind';
};

export type ReadConnectorPeopleResult = {
  people: ConnectorPersonRow[];
  problems: ConnectorPersonReadProblem[];
};

/** A directory crawl can see the same person twice in one page of raw answers (a provider
 * quirk, or two pages that overlap). Keeps the last row seen for a given id, so one batch
 * never tries to touch the same unique key twice in one statement. */
export function dedupe_connector_people(
  people: readonly ConnectorPersonRow[],
): ConnectorPersonRow[] {
  const by_external_id = new Map<string, ConnectorPersonRow>();
  for (const person of people) by_external_id.set(person.external_person_id, person);
  return [...by_external_id.values()];
}

const platform_convention_app_keys: ReadonlySet<string> = new Set(['slack']);

function choose_actor_kind_for_new_row(app_key: string): SourceActor['actor_kind'] {
  return platform_convention_app_keys.has(app_key) ? 'platform_user' : 'external_user';
}

/** Stores one app's people directory on `source_actors`, keyed by `(workspace_id,
 * provider, external_id)` with `provider = app_key`. No new table: a connector person is a
 * source actor the same way a dashboard user is. `actor_kind` (`platform_user`/`external_user`/
 * `agent`/`system`) is a platform-wide field that session read-gating depends on
 * (`build_participants.ts`) and is not where a connector's bot/guest/member distinction lives:
 * it is set only on insert, matching the convention the provider's own chat path already uses
 * (`chat_speaker.ts` writes Slack rows with the default `platform_user`) and falling back to
 * `external_user` for every other provider, and it is never touched again, so a directory
 * crawl can never flip an existing chat-speaker row's reader status. The bot/guest/member
 * distinction is merged into `metadata.person_kind` instead. */
export async function upsert_connector_people(
  db: Database,
  input: UpsertConnectorPeopleInput,
): Promise<number> {
  const people = dedupe_connector_people(input.people);
  if (people.length === 0) return 0;
  const rows = await db
    .insert(source_actors)
    .values(
      people.map((person) => ({
        source_actor_id: create_id(id_prefixes.source_actor),
        workspace_id: input.workspace_id,
        actor_kind: choose_actor_kind_for_new_row(input.app_key),
        provider: input.app_key,
        external_id: person.external_person_id,
        display_name: person.display_name ?? null,
        email: person.email ?? null,
        metadata: { person_kind: person.person_kind },
        created_by: input.actor_id,
        last_updated_by: input.actor_id,
      })),
    )
    .onConflictDoUpdate({
      target: [source_actors.workspace_id, source_actors.provider, source_actors.external_id],
      targetWhere: sql`${source_actors.provider} is not null and ${source_actors.external_id} is not null`,
      set: {
        display_name: sql`excluded.display_name`,
        email: sql`excluded.email`,
        metadata: sql`coalesce(${source_actors.metadata}, '{}'::jsonb) || excluded.metadata`,
        last_updated_by: sql`excluded.last_updated_by`,
        last_updated_time: new Date(),
      },
    })
    .returning({ source_actor_id: source_actors.source_actor_id });
  return rows.length;
}

/** Reads one app's people directory for one workspace, for building the in-memory lookup
 * map a crawl resolves mentions and lines against. A row whose `metadata.person_kind` is not
 * one of the known kinds is reported as a problem instead of silently defaulting, since that
 * default would hide a real data gap. */
export async function read_connector_people(
  db: Database,
  input: { workspace_id: string; app_key: string },
): Promise<ReadConnectorPeopleResult> {
  const rows = await db
    .select({
      source_actor_id: source_actors.source_actor_id,
      external_person_id: source_actors.external_id,
      display_name: source_actors.display_name,
      email: source_actors.email,
      metadata: source_actors.metadata,
    })
    .from(source_actors)
    .where(
      and(
        eq(source_actors.workspace_id, input.workspace_id),
        eq(source_actors.provider, input.app_key),
        isNotNull(source_actors.external_id),
      ),
    );

  const people: ConnectorPersonRow[] = [];
  const problems: ConnectorPersonReadProblem[] = [];
  for (const row of rows) {
    const person_kind_lookup = read_person_kind_from_metadata(row.metadata);
    if (person_kind_lookup.outcome !== 'ok') {
      problems.push({ source_actor_id: row.source_actor_id, reason: 'unknown_person_kind' });
      continue;
    }
    people.push({
      external_person_id: require_external_person_id(row.external_person_id),
      display_name: row.display_name ?? undefined,
      email: row.email ?? undefined,
      person_kind: person_kind_lookup.person_kind,
    });
  }
  return { people, problems };
}

type PersonKindLookup =
  | { outcome: 'ok'; person_kind: ConnectorPersonKind }
  | { outcome: 'unknown_person_kind'; raw_value: unknown };

function read_person_kind_from_metadata(metadata: Record<string, unknown>): PersonKindLookup {
  const raw_value = metadata.person_kind;
  const person_kind =
    typeof raw_value === 'string' ? person_kind_by_raw_value.get(raw_value) : undefined;
  if (person_kind) return { outcome: 'ok', person_kind };
  return { outcome: 'unknown_person_kind', raw_value };
}

function require_external_person_id(external_person_id: string | null): string {
  if (external_person_id === null) {
    throw new Error('connector_people row has no external_person_id despite the not-null filter');
  }
  return external_person_id;
}
