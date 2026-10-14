import type { GranteeType } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';
import type { GrantHolder } from '@coworker/core/db/queries/resource_grants';
import { agents, api_keys, users, workspace_members } from '@coworker/core/db/schema';
import { projects } from '@coworker/core/db/schema/projects';
import { and, eq, inArray, isNull } from 'drizzle-orm';

export async function find_unknown_parties(
  db: Database,
  input: { workspace_id: string; parties: readonly GrantHolder[] },
): Promise<GrantHolder[]> {
  const wanted = new Map<GranteeType, Set<string>>();
  for (const party of input.parties) {
    const ids = wanted.get(party.grantee_type) ?? new Set<string>();
    ids.add(party.grantee_id);
    wanted.set(party.grantee_type, ids);
  }

  const known = new Map<GranteeType, Set<string>>();
  for (const [grantee_type, ids] of wanted) {
    known.set(grantee_type, await read_known_ids(db, input.workspace_id, grantee_type, [...ids]));
  }

  return input.parties.filter((party) => !known.get(party.grantee_type)?.has(party.grantee_id));
}

async function read_known_source_actor_ids(): Promise<Set<string>> {
  throw new Error('find_unknown_parties does not support grantee_type "source_actor" yet');
}

const known_id_readers: Record<
  GranteeType,
  (db: Database, workspace_id: string, ids: string[]) => Promise<Set<string>>
> = {
  project: read_known_project_ids,
  user: read_known_user_ids,
  api_key: read_known_api_key_ids,
  agent: read_known_agent_ids,
  source_actor: read_known_source_actor_ids,
};

function read_known_ids(
  db: Database,
  workspace_id: string,
  grantee_type: GranteeType,
  ids: string[],
): Promise<Set<string>> {
  return known_id_readers[grantee_type](db, workspace_id, ids);
}

async function read_known_project_ids(
  db: Database,
  workspace_id: string,
  ids: string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: projects.project_id })
    .from(projects)
    .where(
      and(
        eq(projects.workspace_id, workspace_id),
        eq(projects.project_status, 'active'),
        inArray(projects.project_id, ids),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

async function read_known_user_ids(
  db: Database,
  workspace_id: string,
  ids: string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: workspace_members.user_id })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_status, 'active'),
        inArray(workspace_members.user_id, ids),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

async function read_known_api_key_ids(
  db: Database,
  workspace_id: string,
  ids: string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: api_keys.api_key_id, expires_time: api_keys.expires_time })
    .from(api_keys)
    .where(
      and(
        eq(api_keys.workspace_id, workspace_id),
        isNull(api_keys.revoked_time),
        inArray(api_keys.api_key_id, ids),
      ),
    );
  const live = rows.filter((row) => !row.expires_time || row.expires_time.getTime() >= Date.now());
  return new Set(live.map((row) => row.id));
}

async function read_known_agent_ids(
  db: Database,
  workspace_id: string,
  ids: string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ id: agents.agent_id })
    .from(agents)
    .where(
      and(
        eq(agents.workspace_id, workspace_id),
        eq(agents.agent_status, 'active'),
        inArray(agents.agent_id, ids),
      ),
    );
  return new Set(rows.map((row) => row.id));
}
