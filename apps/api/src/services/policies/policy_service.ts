import type { Database, DatabaseExecutor } from '@coworker/core';
import { enqueue_event_jobs_in_transaction } from '@coworker/core/db/queries/events';
import {
  delete_policy,
  type PolicySetInput,
  set_policies,
  set_policy,
} from '@coworker/core/db/queries/policies';
import { delete_policies_in_scope } from '@coworker/core/db/queries/policy_scope_rules';
import type { PolicyMode, PolicyScopeType } from '@coworker/core/db/schema/policies';
import { create_id, id_prefixes, NotFoundError } from '@coworker/shared';

export async function set_policy_and_record_event(
  db: Database,
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
  return db.transaction(async (transaction) => {
    const policy = await set_policy(transaction, input);
    await record_policy_event(transaction, policy, 'set', input.actor_id);
    return policy;
  });
}

export async function delete_policy_and_record_event(
  db: Database,
  input: { workspace_id: string; policy_id: string; actor_id: string },
) {
  return db.transaction(async (transaction) => {
    const policy = await delete_policy(transaction, input);
    if (!policy) throw new NotFoundError('Policy');
    await record_policy_event(transaction, policy, 'deleted', input.actor_id);
    return policy;
  });
}

export async function change_policies_and_record_event(
  db: Database,
  input: {
    workspace_id: string;
    scope_type: PolicyScopeType;
    scope_id: string;
    delete_policy_ids: readonly string[];
    set_policies: readonly PolicySetInput[];
    actor_id: string;
  },
) {
  return db.transaction(async (transaction) => {
    const deleted = await delete_policies_in_scope(transaction, {
      workspace_id: input.workspace_id,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      policy_ids: input.delete_policy_ids,
    });
    const written = await set_policies(transaction, {
      workspace_id: input.workspace_id,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      policies: input.set_policies,
      actor_id: input.actor_id,
    });
    await record_policy_batch_event(transaction, input, deleted, written);
    return { deleted, written };
  });
}

async function record_policy_event(
  db: DatabaseExecutor,
  policy: {
    policy_id: string;
    workspace_id: string;
    resource_type: string;
    resource_id: string;
    scope_type: string;
    scope_id: string;
    policy_mode: string;
  },
  action: 'set' | 'deleted',
  actor_id: string,
) {
  await enqueue_event_jobs_in_transaction(db, {
    workspace_id: policy.workspace_id,
    source: 'policy',
    source_event_id: create_id(id_prefixes.event),
    event_type: 'policy.changed',
    queue_key: `policy:${policy.policy_id}`,
    actor_key: actor_id,
    event_body: {
      action,
      policy_id: policy.policy_id,
      resource_type: policy.resource_type,
      resource_id: policy.resource_id,
      scope_type: policy.scope_type,
      scope_id: policy.scope_id,
      policy_mode: policy.policy_mode,
    },
  });
}

async function record_policy_batch_event(
  db: DatabaseExecutor,
  input: { workspace_id: string; scope_type: string; scope_id: string; actor_id: string },
  deleted: Array<{ policy_id: string; resource_type: string; resource_id: string }>,
  written: Array<{
    policy_id: string;
    resource_type: string;
    resource_id: string;
    policy_mode: string;
  }>,
) {
  if (deleted.length === 0 && written.length === 0) return;
  await enqueue_event_jobs_in_transaction(db, {
    workspace_id: input.workspace_id,
    source: 'policy',
    source_event_id: create_id(id_prefixes.event),
    event_type: 'policy.changed',
    queue_key: `policy-scope:${input.scope_type}:${input.scope_id}`,
    actor_key: input.actor_id,
    event_body: {
      action: 'batch',
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      deleted: deleted.map((policy) => ({
        policy_id: policy.policy_id,
        resource_type: policy.resource_type,
        resource_id: policy.resource_id,
      })),
      written: written.map((policy) => ({
        policy_id: policy.policy_id,
        resource_type: policy.resource_type,
        resource_id: policy.resource_id,
        policy_mode: policy.policy_mode,
      })),
    },
  });
}
