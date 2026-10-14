import type { Database } from '@coworker/core/db/connection';
import { user_display_name } from '@coworker/core/db/queries/users';
import { runs, sessions, users } from '@coworker/core/db/schema';
import type { SessionSourceActor } from '@coworker/shared';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

type RunInitiatorKind = 'user' | 'slack' | 'email' | 'schedule' | 'api' | 'system';

type RunActivityInitiator = {
  kind: RunInitiatorKind;
  name: string;
  avatar_url: string | null;
};

export type RunActivityItem = {
  run_id: string;
  started_at: string;
  cost_microcents: number;
  run_status: string;
  initiator: RunActivityInitiator;
};

export type RunActivityPage = {
  runs: RunActivityItem[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
};

const default_page_size = 20;
const max_page_size = 100;

const scheduled_actor_id = 'system:trigger';

type InitiatorUser = Pick<
  typeof users.$inferSelect,
  'first_name' | 'last_name' | 'email' | 'avatar_url'
>;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function earliest_human_source_actor(session_metadata: unknown): SessionSourceActor | null {
  const actors = (session_metadata as { actors?: SessionSourceActor[] } | null)?.actors;
  if (!Array.isArray(actors)) return null;
  const humans = actors.filter(
    (actor) => actor.actor_kind !== 'agent' && actor.actor_kind !== 'system',
  );
  if (humans.length === 0) return null;
  return humans.reduce((earliest, actor) =>
    actor.first_seen_time < earliest.first_seen_time ? actor : earliest,
  );
}

function resolve_initiator(input: {
  created_by: string;
  session_source: string;
  session_metadata: unknown;
  user: InitiatorUser | undefined;
}): RunActivityInitiator {
  if (input.created_by === scheduled_actor_id || input.session_source === 'trigger') {
    return { kind: 'schedule', name: 'Scheduled', avatar_url: null };
  }
  if (input.session_source === 'slack') {
    const actor = earliest_human_source_actor(input.session_metadata);
    return {
      kind: 'slack',
      name: actor?.profile.display_name ?? actor?.profile.real_name ?? 'Slack',
      avatar_url: actor?.profile.avatar_url ?? null,
    };
  }
  if (input.session_source === 'email') {
    const actor = earliest_human_source_actor(input.session_metadata);
    return {
      kind: 'email',
      name: actor?.profile.display_name ?? actor?.profile.email ?? 'Email',
      avatar_url: actor?.profile.avatar_url ?? null,
    };
  }
  if (input.session_source === 'api') {
    return { kind: 'api', name: 'API', avatar_url: null };
  }
  if (input.session_source === 'system') {
    return { kind: 'system', name: 'System', avatar_url: null };
  }
  if (input.user) {
    return {
      kind: 'user',
      name: user_display_name(input.user),
      avatar_url: input.user.avatar_url ?? null,
    };
  }
  return { kind: 'user', name: 'Unknown', avatar_url: null };
}

export async function list_workspace_runs(
  db: Database,
  input: { workspace_id: string; page?: number; page_size?: number },
): Promise<RunActivityPage> {
  const page_size = clamp(Math.floor(input.page_size ?? default_page_size), 1, max_page_size);
  const requested_page = Math.max(1, Math.floor(input.page ?? 1));

  const scope = and(eq(runs.workspace_id, input.workspace_id), isNull(runs.parent_run_id));

  const [count_row] = await db.select({ total: count() }).from(runs).where(scope);
  const total = Number(count_row?.total ?? 0);
  const page_count = Math.max(1, Math.ceil(total / page_size));
  const page = Math.min(requested_page, page_count);
  const offset = (page - 1) * page_size;

  const started_or_created = sql`coalesce(${runs.started_time}, ${runs.created_time})`;
  const rows = await db
    .select({
      run_id: runs.run_id,
      session_id: runs.session_id,
      created_by: runs.created_by,
      cost_microcents: runs.cost_microcents,
      run_status: runs.run_status,
      started_time: runs.started_time,
      created_time: runs.created_time,
    })
    .from(runs)
    .where(scope)
    .orderBy(desc(started_or_created), desc(runs.run_id))
    .limit(page_size)
    .offset(offset);

  if (rows.length === 0) {
    return { runs: [], total, page, page_size, page_count };
  }

  const session_ids = [...new Set(rows.map((row) => row.session_id))];
  const user_ids = [
    ...new Set(
      rows.map((row) => row.created_by).filter((id) => Boolean(id) && id !== scheduled_actor_id),
    ),
  ];

  const session_rows = await db
    .select({
      session_id: sessions.session_id,
      session_source: sessions.session_source,
      session_metadata: sessions.session_metadata,
    })
    .from(sessions)
    .where(inArray(sessions.session_id, session_ids));
  const session_by_id = new Map(session_rows.map((row) => [row.session_id, row]));

  const user_rows =
    user_ids.length > 0
      ? await db
          .select({
            user_id: users.user_id,
            first_name: users.first_name,
            last_name: users.last_name,
            email: users.email,
            avatar_url: users.avatar_url,
          })
          .from(users)
          .where(inArray(users.user_id, user_ids))
      : [];
  const user_by_id = new Map(user_rows.map((row) => [row.user_id, row]));

  const activity = rows.map((row) => {
    const session = session_by_id.get(row.session_id);
    return {
      run_id: row.run_id,
      started_at: (row.started_time ?? row.created_time).toISOString(),
      cost_microcents: Number(row.cost_microcents),
      run_status: row.run_status,
      initiator: resolve_initiator({
        created_by: row.created_by,
        session_source: session?.session_source ?? 'dashboard',
        session_metadata: session?.session_metadata,
        user: user_by_id.get(row.created_by),
      }),
    };
  });

  return { runs: activity, total, page, page_size, page_count };
}
