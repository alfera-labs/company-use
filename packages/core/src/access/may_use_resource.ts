import type { ResourceDefaultAccess } from '@coworker/core/access/resource_types';
import { z } from 'zod';

export const grantee_types = ['project', 'user', 'agent', 'source_actor', 'api_key'] as const;

export type GranteeType = (typeof grantee_types)[number];

const grantee_type_schema = z.enum(grantee_types);

export type GrantLevel = 'use' | 'manage';

const grant_level_rank: Record<GrantLevel, number> = { use: 0, manage: 1 };

export type GrantRule = {
  grantee_type: GranteeType;
  grantee_id: string;
  grant_level: GrantLevel;
};

/** A grant as stored. Its grantee type is checked against `grantee_types` by the gate. */
export type StoredGrantRule = Omit<GrantRule, 'grantee_type'> & { grantee_type: string };

type RequiredGranteeType = 'project' | 'user' | 'agent';
type OptionalGranteeType = Exclude<GranteeType, RequiredGranteeType>;

export type Participants = Readonly<Record<RequiredGranteeType, readonly string[]>> &
  Readonly<Partial<Record<OptionalGranteeType, readonly string[]>>>;

export const empty_participants: Participants = { project: [], user: [], agent: [] };

type ResourceUseDenialReason =
  | 'not_on_the_list'
  | 'nobody_present_to_check'
  | 'nothing_is_granted'
  | 'unregistered_grantee_type';

export type ResourceUseVerdict =
  | { allowed: true; grant_level: GrantLevel }
  | {
      allowed: false;
      denial_reason: ResourceUseDenialReason;
      blocked_grantee_type: GranteeType | null;
      blocked_grantee_ids: readonly string[];
    };

export type MayUseResourceInput = {
  default_access: ResourceDefaultAccess;
  grants: readonly StoredGrantRule[];
  participants: Participants;
  owner_user_id?: string | null | undefined;
  room_private_to?: string | null | undefined;
};

export function may_use_resource(input: MayUseResourceInput): ResourceUseVerdict {
  if (owner_is_alone_in_their_own_room(input)) return { allowed: true, grant_level: 'manage' };
  if (input.grants.length === 0) return verdict_for_unrestricted_resource(input.default_access);

  const { registered, unregistered_grantee_ids } = split_by_registered_type(input.grants);
  if (unregistered_grantee_ids.length > 0) {
    return deny('unregistered_grantee_type', null, unregistered_grantee_ids);
  }

  let gathering_level: GrantLevel = 'manage';
  for (const grantee_type of grantee_types) {
    const rules = registered.filter((grant) => grant.grantee_type === grantee_type);
    if (rules.length === 0) continue;

    const present = input.participants[grantee_type] ?? [];
    if (present.length === 0) {
      return deny('nobody_present_to_check', grantee_type, []);
    }

    const blocked = present.filter((participant) => !has_rule_for(rules, participant));
    if (blocked.length > 0) return deny('not_on_the_list', grantee_type, blocked);

    gathering_level = weaker_of(gathering_level, weakest_level_among(rules, present));
  }

  return { allowed: true, grant_level: gathering_level };
}

export function find_grant_level(
  grants: readonly StoredGrantRule[],
  grantee_type: GranteeType,
  grantee_id: string,
): GrantLevel | null {
  const rule = grants.find(
    (grant) => grant.grantee_type === grantee_type && grant.grantee_id === grantee_id,
  );
  return rule ? rule.grant_level : null;
}

function owner_is_alone_in_their_own_room(input: MayUseResourceInput): boolean {
  const owner = input.owner_user_id;
  if (!owner || input.room_private_to !== owner) return false;
  const present = input.participants.user;
  return present.length > 0 && present.every((user) => user === owner);
}

function split_by_registered_type(grants: readonly StoredGrantRule[]): {
  registered: GrantRule[];
  unregistered_grantee_ids: string[];
} {
  const registered: GrantRule[] = [];
  const unregistered_grantee_ids: string[] = [];
  for (const grant of grants) {
    const parsed = grantee_type_schema.safeParse(grant.grantee_type);
    if (parsed.success) registered.push({ ...grant, grantee_type: parsed.data });
    else unregistered_grantee_ids.push(grant.grantee_id);
  }
  return { registered, unregistered_grantee_ids };
}

function verdict_for_unrestricted_resource(
  default_access: ResourceDefaultAccess,
): ResourceUseVerdict {
  if (default_access === 'everyone_in_the_workspace') {
    return { allowed: true, grant_level: 'use' };
  }
  return {
    allowed: false,
    denial_reason: 'nothing_is_granted',
    blocked_grantee_type: null,
    blocked_grantee_ids: [],
  };
}

function deny(
  denial_reason: ResourceUseDenialReason,
  blocked_grantee_type: GranteeType | null,
  blocked_grantee_ids: readonly string[],
): ResourceUseVerdict {
  return { allowed: false, denial_reason, blocked_grantee_type, blocked_grantee_ids };
}

function has_rule_for(rules: readonly GrantRule[], grantee_id: string): boolean {
  return rules.some((rule) => rule.grantee_id === grantee_id);
}

function weakest_level_among(rules: readonly GrantRule[], present: readonly string[]): GrantLevel {
  let level: GrantLevel = 'manage';
  for (const grantee_id of present) {
    const rule = rules.find((candidate) => candidate.grantee_id === grantee_id);
    if (rule) level = weaker_of(level, rule.grant_level);
  }
  return level;
}

function weaker_of(left: GrantLevel, right: GrantLevel): GrantLevel {
  return grant_level_rank[left] <= grant_level_rank[right] ? left : right;
}
