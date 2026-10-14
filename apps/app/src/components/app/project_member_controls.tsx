import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Bot, User, X } from 'lucide-react';
import { AddProjectMemberForm } from '@/components/app/project_member_add_form';
import {
  type GrantLevel,
  grant_level_labels,
  person_name,
} from '@/components/app/project_member_words';
import { ProjectSection } from '@/components/app/project_section';
import type { WorkspaceMember } from '@/lib/api/endpoints';
import type { Agent, Project, ProjectMember } from '@/lib/api/types';

export type ProjectMemberControlsProps = {
  project: Project;
  can_manage: boolean;
  members: ProjectMember[];
  people: WorkspaceMember[];
  agents: Agent[];
  is_loading: boolean;
  error_message: string | undefined;
  grantee_id: string;
  grant_level: GrantLevel;
  is_adding: boolean;
  is_removing: boolean;
  set_grantee_id: (id: string) => void;
  set_grant_level: (level: GrantLevel) => void;
  add_member: () => void;
  remove_member: (member: ProjectMember) => void;
};

export function ProjectMemberControls(props: ProjectMemberControlsProps) {
  return (
    <ProjectSection title="Access" description={access_description(props.project.project_access)}>
      <div className="space-y-4">
        {props.is_loading ? <Skeleton className="h-20 w-full" /> : null}
        {props.error_message ? (
          <p className="text-destructive text-sm">{props.error_message}</p>
        ) : null}
        <ProjectMemberList {...props} />
        {props.can_manage ? <AddProjectMemberForm {...props} /> : null}
      </div>
    </ProjectSection>
  );
}

function ProjectMemberList(props: ProjectMemberControlsProps) {
  return (
    <ul className="divide-y rounded-xl border">
      {props.members.map((member) => (
        <li key={member.resource_grant_id} className="flex items-center gap-3 px-3 py-2">
          {member.grantee_type === 'agent' ? (
            <Bot className="size-4 text-muted-foreground" />
          ) : (
            <User className="size-4 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">
              {member_name(member, props.people, props.agents)}
            </span>
            <MemberEmail member={member} people={props.people} />
          </span>
          <span className="text-muted-foreground text-xs">
            {grant_level_labels[member.grant_level as GrantLevel] ?? member.grant_level}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Remove member"
            disabled={!props.can_manage || props.is_removing}
            onClick={() => props.remove_member(member)}
          >
            <X className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function MemberEmail({ member, people }: { member: ProjectMember; people: WorkspaceMember[] }) {
  if (member.grantee_type !== 'user') return null;
  const email = people.find((one) => one.user_id === member.grantee_id)?.email;
  if (!email) return null;
  return <span className="block truncate text-muted-foreground text-xs">{email}</span>;
}

function member_name(member: ProjectMember, people: WorkspaceMember[], agents: Agent[]) {
  if (member.grantee_type === 'agent') {
    return (
      agents.find((agent) => agent.agent_id === member.grantee_id)?.agent_name ?? 'Unknown coworker'
    );
  }
  const person = people.find((one) => one.user_id === member.grantee_id);
  return person ? person_name(person) : 'Unknown person';
}

function access_description(access: Project['project_access']) {
  if (access === 'private') {
    return 'Only you can see this.';
  }
  if (access === 'workspace') {
    return 'Everyone in the workspace can see this.';
  }
  return 'Only these people can see this.';
}
