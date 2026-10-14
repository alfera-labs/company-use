import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { person_name } from '@/components/app/project_member_words';
import {
  add_project_member,
  list_project_members,
  list_workspace_members,
  type WorkspaceMember,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project, ProjectMember } from '@/lib/api/types';

export function ProjectAddPeopleMenu({ project }: { project: Project }) {
  const query_client = useQueryClient();
  const membership_query = useQuery({
    queryKey: query_keys.project_members(project.project_id),
    queryFn: () => list_project_members(project.project_id),
  });
  const people_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });

  const add_person = useMutation({
    mutationFn: (person: WorkspaceMember) =>
      add_project_member(project.project_id, {
        grantee_type: 'user',
        grantee_id: person.user_id,
        grant_level: level_for_project(project),
      }),
    onSuccess: (_result, person) => {
      toast.success(`${person_name(person)} added to ${project.project_name}.`);
      query_client.invalidateQueries({ queryKey: query_keys.project_members(project.project_id) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const choices = people_not_in_project(
    membership_query.data?.members ?? [],
    people_query.data ?? [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={add_person.isPending}
        render={
          <Button size="sm" type="button" variant="ghost">
            {add_person.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Add people
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56">
        {choices.length === 0 ? (
          <DropdownMenuLabel>Everyone is already in this project.</DropdownMenuLabel>
        ) : (
          choices.map((person) => (
            <DropdownMenuItem key={person.user_id} onClick={() => add_person.mutate(person)}>
              {person_name(person)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function people_not_in_project(
  members: readonly ProjectMember[],
  people: readonly WorkspaceMember[],
): WorkspaceMember[] {
  const already_in = new Set(
    members.filter((member) => member.grantee_type === 'user').map((member) => member.grantee_id),
  );
  return people.filter((person) => !already_in.has(person.user_id));
}

function level_for_project(project: Project) {
  return project.project_access === 'workspace' ? 'manage' : 'use';
}
