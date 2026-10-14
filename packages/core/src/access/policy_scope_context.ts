import { build_participants } from '@coworker/core/access/build_participants';
import { empty_participants, type Participants } from '@coworker/core/access/may_use_resource';
import type { PolicyScopeIds } from '@coworker/core/access/policy_modes';
import type { Database } from '@coworker/core/db/connection';
import { get_session } from '@coworker/core/db/queries/sessions';
import { resolve_user_id_for_source_actor } from '@coworker/core/db/queries/source_actors';
import { id_prefixes } from '@coworker/shared';

export async function read_policy_scope_ids(
  db: Database,
  input: {
    workspace_id: string;
    session_id?: string | undefined;
    agent_id?: string;
    actor_id: string;
    acting_actor_id?: string;
    connection_ids?: readonly string[];
  },
): Promise<PolicyScopeIds> {
  const [participants, acting_user_id] = await Promise.all([
    read_session_participants(db, input),
    input.acting_actor_id
      ? resolve_user_id_for_source_actor(db, {
          workspace_id: input.workspace_id,
          source_actor_id: input.acting_actor_id,
        })
      : undefined,
  ]);
  const actor_user_id = decider_actor_id(input.actor_id);

  return {
    workspace: [input.workspace_id],
    connection: unique(input.connection_ids ?? []),
    project: unique(participants.project),
    agent: unique(participants.agent),
    user: unique([
      ...participants.user,
      ...(acting_user_id ? [acting_user_id] : []),
      ...(actor_user_id ? [actor_user_id] : []),
    ]),
  };
}

async function read_session_participants(
  db: Database,
  input: { workspace_id: string; session_id?: string | undefined; agent_id?: string },
): Promise<Participants> {
  if (!input.session_id) return empty_participants;
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) throw new Error(`Policy session not found: ${input.session_id}`);
  return build_participants({
    project_id: session.project_id,
    session_metadata: session.session_metadata,
    session_source_metadata: session.source_metadata,
    agent_ids: [input.agent_id ?? session.agent_id],
  });
}

const actor_prefixes_that_decide = [id_prefixes.user, id_prefixes.api_key];

function decider_actor_id(actor_id: string) {
  const decides = actor_prefixes_that_decide.some((prefix) => actor_id.startsWith(`${prefix}_`));
  return decides ? actor_id : undefined;
}

export function policy_scope_refs(scopes: PolicyScopeIds) {
  return (Object.entries(scopes) as Array<[keyof PolicyScopeIds, readonly string[]]>).flatMap(
    ([scope_type, scope_ids]) => scope_ids.map((scope_id) => ({ scope_type, scope_id })),
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
