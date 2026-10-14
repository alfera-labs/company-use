import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { ProjectChannelsSection } from '@/components/app/project_channels_section';
import { ProjectConnectionsSection } from '@/components/app/project_connections_section';
import { ProjectMembersSection } from '@/components/app/project_members_section';
import { ProjectOverviewForm } from '@/components/app/project_overview_form';
import { ToolPolicySettings } from '@/components/app/tool_policy_settings';
import { create_session, get_project } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export function ProjectDetailPage({ project_id }: { project_id: string }) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const project_query = useQuery({
    queryKey: query_keys.project(project_id),
    queryFn: () => get_project(project_id),
  });
  const start_chat = useMutation({
    mutationFn: () => create_session({ project_id }),
    onSuccess: (session) => {
      query_client.invalidateQueries({ queryKey: query_keys.sessions() });
      navigate({ href: `/chats/${session.session_id}` });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (project_query.isPending) {
    return <Skeleton className="mx-auto mt-10 h-96 w-[min(56rem,calc(100%-3rem))]" />;
  }
  if (project_query.isError) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-destructive">{project_query.error.message}</p>
        <Link className="mt-3 inline-block text-sm underline" to="/projects">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <ProjectDetailContent
      project={project_query.data}
      is_starting_chat={start_chat.isPending}
      start_chat={() => start_chat.mutate()}
    />
  );
}

function ProjectDetailContent({
  project,
  is_starting_chat,
  start_chat,
}: {
  project: Project;
  is_starting_chat: boolean;
  start_chat: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
      <Link
        to="/projects"
        className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-2xl">{project.project_name}</h1>
          {project.project_description ? (
            <p className="mt-1 text-muted-foreground text-sm">{project.project_description}</p>
          ) : null}
        </div>
        <Button onClick={start_chat} disabled={is_starting_chat}>
          <MessageSquarePlus className="size-4" /> New chat
        </Button>
      </header>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <ProjectOverviewForm project={project} can_manage={project.can_manage ?? false} />
        <ProjectMembersSection project={project} can_manage={project.can_manage ?? false} />
        <ProjectConnectionsSection
          project_id={project.project_id}
          room_name={project.project_name}
        />
        <ProjectChannelsSection
          project_id={project.project_id}
          can_manage={project.can_manage ?? false}
        />
        <div className="p-5">
          <ToolPolicySettings
            scope_type="project"
            scope_id={project.project_id}
            description="Stricter rules for this project."
            read_only={!project.can_manage}
          />
        </div>
      </div>
    </div>
  );
}
