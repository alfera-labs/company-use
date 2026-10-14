import type { GrantRule } from '@coworker/core/access/may_use_resource';
import type { ResourceDefaultAccess } from '@coworker/core/access/resource_types';

export type WhereAPersonCanUse =
  | { where: 'everywhere' }
  | { where: 'projects'; project_ids: string[] }
  | { where: 'own_chats' }
  | { where: 'nowhere' };

export type WhereAPersonCanUseInput = {
  default_access: ResourceDefaultAccess;
  grants: readonly GrantRule[];
  person_user_id: string;
  owner_user_id: string | null;
  project_ids_the_person_is_in: readonly string[];
};

export function where_a_person_can_use(input: WhereAPersonCanUseInput): WhereAPersonCanUse {
  const granted = where_the_grants_allow(input);
  if (granted.where !== 'nowhere') return granted;
  return input.person_user_id === input.owner_user_id ? { where: 'own_chats' } : granted;
}

function where_the_grants_allow(input: WhereAPersonCanUseInput): WhereAPersonCanUse {
  const named_people = ids_granted_to(input.grants, 'user');
  const named_projects = ids_granted_to(input.grants, 'project');

  if (named_people.length === 0 && named_projects.length === 0) {
    return {
      where: input.default_access === 'everyone_in_the_workspace' ? 'everywhere' : 'nowhere',
    };
  }
  if (named_people.length > 0 && !named_people.includes(input.person_user_id)) {
    return { where: 'nowhere' };
  }
  if (named_projects.length === 0) return { where: 'own_chats' };

  const project_ids = named_projects.filter((project_id) =>
    input.project_ids_the_person_is_in.includes(project_id),
  );
  return project_ids.length > 0 ? { where: 'projects', project_ids } : { where: 'nowhere' };
}

function ids_granted_to(grants: readonly GrantRule[], grantee_type: 'user' | 'project') {
  return grants
    .filter((grant) => grant.grantee_type === grantee_type)
    .map((grant) => grant.grantee_id);
}
