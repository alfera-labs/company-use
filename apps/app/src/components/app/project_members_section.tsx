import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProjectMemberControls } from '@/components/app/project_member_controls';
import {
  add_project_member,
  list_agents,
  list_project_members,
  list_workspace_members,
  remove_project_member,
  type WorkspaceMember,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Agent, Project, ProjectMember } from '@/lib/api/types';

export function ProjectMembersSection({
  project,
  can_manage,
}: {
  project: Project;
  can_manage: boolean;
}) {
  const [grantee_id, set_grantee_id] = useState('');
  const [grant_level, set_grant_level] = useState<'use' | 'manage'>('use');
  const membership_query = useQuery({
    queryKey: query_keys.project_members(project.project_id),
    queryFn: () => list_project_members(project.project_id),
  });
  const people_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const agents_query = useQuery({ queryKey: query_keys.agents(), queryFn: list_agents });
  return (
    <ProjectMemberMutations
      project={project}
      can_manage={can_manage}
      members={membership_query.data?.members ?? []}
      people={people_query.data ?? []}
      agents={agents_query.data ?? []}
      is_loading={membership_query.isPending}
      error_message={membership_query.error?.message}
      grantee_id={grantee_id}
      grant_level={grant_level}
      set_grantee_id={set_grantee_id}
      set_grant_level={set_grant_level}
    />
  );
}

type ProjectMemberMutationProps = {
  project: Project;
  can_manage: boolean;
  members: ProjectMember[];
  people: WorkspaceMember[];
  agents: Agent[];
  is_loading: boolean;
  error_message: string | undefined;
  grantee_id: string;
  grant_level: 'use' | 'manage';
  set_grantee_id: (id: string) => void;
  set_grant_level: (level: 'use' | 'manage') => void;
};

function ProjectMemberMutations(props: ProjectMemberMutationProps) {
  const query_client = useQueryClient();
  const refresh = () =>
    query_client.invalidateQueries({
      queryKey: query_keys.project_members(props.project.project_id),
    });
  const add_member = useMutation({
    mutationFn: () =>
      add_project_member(props.project.project_id, {
        grantee_type: 'user',
        grantee_id: props.grantee_id,
        grant_level: member_grant_level(props),
      }),
    onSuccess: () => {
      props.set_grantee_id('');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove_member = useMutation({
    mutationFn: (member: ProjectMember) =>
      remove_project_member(
        props.project.project_id,
        member.grantee_type as 'user' | 'agent',
        member.grantee_id,
      ),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <ProjectMemberControls
      {...props}
      is_adding={add_member.isPending}
      is_removing={remove_member.isPending}
      add_member={() => add_member.mutate()}
      remove_member={(member) => remove_member.mutate(member)}
    />
  );
}

function member_grant_level(props: ProjectMemberMutationProps) {
  if (props.project.project_access === 'workspace') return 'manage';
  return props.grant_level;
}
