import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FolderOpen, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { read_shared_rooms, room_label } from '@/components/app/chat_room_label';
import { NewProjectDialog } from '@/components/app/new_project_dialog';
import { get_current_workspace, list_projects } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export function ProjectsPage() {
  const [search_text, set_search_text] = useState('');
  const projects_query = useQuery({
    queryKey: query_keys.projects(search_text),
    queryFn: () => list_projects(search_text || undefined),
    placeholderData: keepPreviousData,
  });
  const projects = read_shared_rooms(projects_query.data ?? []);
  const has_no_answer_to_show = projects_query.isPlaceholderData && projects.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl">Projects</h1>
        <p className="text-muted-foreground text-sm">Shared rooms for your team's work.</p>
      </header>

      <ProjectToolbar search_text={search_text} set_search_text={set_search_text} />
      <ProjectList
        error={projects_query.error}
        is_pending={projects_query.isPending || has_no_answer_to_show}
        projects={projects}
        searching={Boolean(search_text)}
      />
    </div>
  );
}

function ProjectToolbar({
  search_text,
  set_search_text,
}: {
  search_text: string;
  set_search_text: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search projects"
          value={search_text}
          onChange={(event) => set_search_text(event.target.value)}
        />
      </div>
      <CreateProjectButton />
    </div>
  );
}

function CreateProjectButton() {
  const [naming, set_naming] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => set_naming(true)}>
        <Plus className="size-4" />
        New project
      </Button>
      <NewProjectDialog open={naming} onOpenChange={set_naming} />
    </>
  );
}

function ProjectList({
  error,
  is_pending,
  projects,
  searching,
}: {
  error: Error | null;
  is_pending: boolean;
  projects: Awaited<ReturnType<typeof list_projects>>;
  searching: boolean;
}) {
  if (is_pending) return <ProjectListSkeleton />;
  if (error)
    return (
      <div className="rounded-2xl border border-destructive/40 p-4 text-destructive text-sm">
        {error.message}
      </div>
    );
  if (!projects.length) return <EmptyProjectList searching={searching} />;
  return (
    <ul className="flex flex-col gap-2">
      {projects.map((project) => (
        <li key={project.project_id}>
          <Link
            to="/projects/$project_id"
            params={{ project_id: project.project_id }}
            className="flex items-center gap-3 rounded-2xl border p-4 transition-colors hover:bg-accent"
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <ProjectName project={project} />
                <Badge variant="secondary" className="shrink-0">
                  {project.project_access === 'workspace' ? 'Workspace' : 'Members'}
                </Badge>
              </span>
              <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                {project.project_description ?? project_description(project.project_access)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function project_description(access: 'private' | 'members' | 'workspace') {
  return access === 'workspace' ? 'Open to everyone in the workspace.' : 'Open to project members.';
}

function ProjectListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {['a', 'b', 'c'].map((key) => (
        <Skeleton key={key} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function EmptyProjectList({ searching }: { searching: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center">
      <p className="font-medium">{searching ? 'No project matches that.' : 'No projects yet.'}</p>
      <p className="mt-1 text-muted-foreground text-sm">
        {searching
          ? 'Try a different name.'
          : 'Name one above. You will be its only member until you add someone.'}
      </p>
    </div>
  );
}

/** The name the sidebar gives the project: the project of everyone goes by the workspace name. */
export function ProjectName({ project }: { project: Project }) {
  const workspace_name = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  }).data?.workspace_name;
  return (
    <span className="truncate font-medium">
      {room_label(project.project_id, [project], workspace_name)}
    </span>
  );
}
