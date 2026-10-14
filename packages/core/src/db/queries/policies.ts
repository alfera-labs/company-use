import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { policies, tool_calls } from '@coworker/core/db/schema';
import type { PolicyMode, PolicyScopeType } from '@coworker/core/db/schema/policies';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, count, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';

export type PolicyResourceRef = { resource_type: string; resource_id: string };
export type PolicyScopeRef = { scope_type: PolicyScopeType; scope_id: string };
export type PolicySetInput = {
  resource_type: string;
  resource_id: string;
  policy_mode: PolicyMode;
  metadata?: Record<string, unknown> | undefined;
};

export async function list_policies(
  db: Database,
  input: {
    workspace_id: string;
    resource_type?: string;
    resource_id?: string;
    scope_type?: PolicyScopeType;
    scope_id?: string;
    limit?: number;
  },
) {
  return db.query.policies.findMany({
    where: and(
      eq(policies.workspace_id, input.workspace_id),
      ...(input.resource_type ? [eq(policies.resource_type, input.resource_type)] : []),
      ...(input.resource_id ? [eq(policies.resource_id, input.resource_id)] : []),
      ...(input.scope_type ? [eq(policies.scope_type, input.scope_type)] : []),
      ...(input.scope_id ? [eq(policies.scope_id, input.scope_id)] : []),
    ),
    orderBy: [desc(policies.last_updated_time)],
    limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
  });
}

export async function list_applicable_policies(
  db: Database,
  input: {
    workspace_id: string;
    resources: readonly PolicyResourceRef[];
    scopes: readonly PolicyScopeRef[];
  },
) {
  if (input.resources.length === 0 || input.scopes.length === 0) return [];
  return db.query.policies.findMany({
    where: and(
      eq(policies.workspace_id, input.workspace_id),
      or(
        ...input.resources.map((resource) =>
          and(
            eq(policies.resource_type, resource.resource_type),
            eq(policies.resource_id, resource.resource_id),
          ),
        ),
      ),
      or(
        ...input.scopes.map((scope) =>
          and(eq(policies.scope_type, scope.scope_type), eq(policies.scope_id, scope.scope_id)),
        ),
      ),
    ),
  });
}

export async function get_policy(db: Database, input: { workspace_id: string; policy_id: string }) {
  return (
    (await db.query.policies.findFirst({
      where: and(
        eq(policies.workspace_id, input.workspace_id),
        eq(policies.policy_id, input.policy_id),
      ),
    })) ?? null
  );
}

export async function set_policy(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    resource_type: string;
    resource_id: string;
    scope_type: PolicyScopeType;
    scope_id: string;
    policy_mode: PolicyMode;
    metadata?: Record<string, unknown>;
    actor_id: string;
  },
) {
  const now = new Date();
  const [policy] = await db
    .insert(policies)
    .values({
      policy_id: create_id(id_prefixes.policy),
      workspace_id: input.workspace_id,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      policy_mode: input.policy_mode,
      metadata: input.metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoUpdate({
      target: [
        policies.workspace_id,
        policies.resource_type,
        policies.resource_id,
        policies.scope_type,
        policies.scope_id,
      ],
      set: {
        policy_mode: input.policy_mode,
        metadata: input.metadata ?? {},
        last_updated_time: now,
        last_updated_by: input.actor_id,
      },
    })
    .returning();
  return require_inserted_row(policy, 'Policy');
}

export async function delete_policy(
  db: DatabaseExecutor,
  input: { workspace_id: string; policy_id: string },
) {
  const [policy] = await db
    .delete(policies)
    .where(
      and(eq(policies.workspace_id, input.workspace_id), eq(policies.policy_id, input.policy_id)),
    )
    .returning();
  return policy ?? null;
}

export async function set_policies(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    scope_type: PolicyScopeType;
    scope_id: string;
    policies: readonly PolicySetInput[];
    actor_id: string;
  },
) {
  if (input.policies.length === 0) return [];
  const now = new Date();
  return db
    .insert(policies)
    .values(
      input.policies.map((policy) => ({
        policy_id: create_id(id_prefixes.policy),
        workspace_id: input.workspace_id,
        scope_type: input.scope_type,
        scope_id: input.scope_id,
        resource_type: policy.resource_type,
        resource_id: policy.resource_id,
        policy_mode: policy.policy_mode,
        metadata: policy.metadata ?? {},
        created_by: input.actor_id,
        last_updated_by: input.actor_id,
      })),
    )
    .onConflictDoUpdate({
      target: [
        policies.workspace_id,
        policies.resource_type,
        policies.resource_id,
        policies.scope_type,
        policies.scope_id,
      ],
      set: {
        policy_mode: sql.raw('excluded.policy_mode'),
        metadata: sql.raw('excluded.metadata'),
        last_updated_time: now,
        last_updated_by: input.actor_id,
      },
    })
    .returning();
}

// Counted per tool for the whole workspace, which is what a cap on a node grant means
// while one scope writes one row. Count per policy row if two scopes ever cap the same tool
// differently.
export async function count_tool_calls_today(
  db: Database,
  input: { workspace_id: string; node_key: string; since: Date },
) {
  const [row] = await db
    .select({ calls: count() })
    .from(tool_calls)
    .where(
      and(
        eq(tool_calls.workspace_id, input.workspace_id),
        eq(tool_calls.tool_name, input.node_key),
        gte(tool_calls.created_time, input.since),
        inArray(tool_calls.tool_status, ['executing', 'completed']),
      ),
    );
  return row?.calls ?? 0;
}
