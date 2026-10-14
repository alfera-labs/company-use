import type { GranteeType, ResourceUseVerdict } from '@coworker/core/access/may_use_resource';

export type ResourceUseNames = {
  resource_label: string;
  grantee_labels?: Readonly<Record<string, string>>;
};

const blocked_party_nouns: Record<GranteeType, { one: string; many: string }> = {
  project: { one: 'this project', many: 'these projects' },
  user: { one: 'is in this chat', many: 'are in this chat' },
  agent: { one: 'this coworker', many: 'these coworkers' },
  source_actor: { one: 'this account', many: 'these accounts' },
  api_key: { one: 'this API key', many: 'these API keys' },
};

export function describe_resource_use(
  verdict: ResourceUseVerdict,
  names: ResourceUseNames,
): string {
  if (verdict.allowed) return `${names.resource_label} is available here.`;

  if (verdict.denial_reason === 'nothing_is_granted') {
    return `${names.resource_label} has no members yet, so nobody can open it.`;
  }

  if (verdict.denial_reason === 'unregistered_grantee_type') {
    return (
      `${names.resource_label} is shared with a kind of party this workspace cannot check, ` +
      'so nobody can open it.'
    );
  }

  if (verdict.denial_reason === 'nobody_present_to_check') {
    return (
      `${names.resource_label} is limited to named people, ` +
      'and this run has nobody in it to check against that list.'
    );
  }

  const blocked = verdict.blocked_grantee_ids.map((id) => label_for(id, names));
  const noun = blocked_party_nouns[verdict.blocked_grantee_type ?? 'project'];

  if (verdict.blocked_grantee_type === 'user') {
    const verb = blocked.length === 1 ? noun.one : noun.many;
    return (
      `${names.resource_label} is limited to specific people. ` +
      `${format_list(blocked)} ${verb} and ${blocked.length === 1 ? 'is' : 'are'} not on its list.`
    );
  }

  const subject = blocked.length === 1 ? noun.one : noun.many;
  return `${names.resource_label} is not available to ${subject} (${format_list(blocked)}).`;
}

function label_for(grantee_id: string, names: ResourceUseNames): string {
  return names.grantee_labels?.[grantee_id] ?? grantee_id;
}

function format_list(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}
