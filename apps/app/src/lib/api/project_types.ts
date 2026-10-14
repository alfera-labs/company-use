export type Project = {
  project_id: string;
  workspace_id: string;
  project_name: string;
  project_status: 'active' | 'archived';
  project_access: 'private' | 'members' | 'workspace';
  is_workspace_default: boolean;
  project_description: string | null;
  project_instructions: string | null;
  can_manage?: boolean;
  membership_version: number;
  personal_for_user_id: string | null;
  created_time: string;
  last_updated_time: string;
};

type ResourceGrant = {
  resource_grant_id: string;
  resource_type: string;
  resource_id: string;
  grantee_type: 'project' | 'user' | 'agent';
  grantee_id: string;
  grant_level: 'use' | 'manage';
};

export type ProjectMember = ResourceGrant;

export type ProjectMembership = {
  membership_version: number;
  members: ProjectMember[];
};
