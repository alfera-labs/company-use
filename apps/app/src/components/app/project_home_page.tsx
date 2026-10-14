import { Button, buttonVariants } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageSquare, MessageSquarePlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { ProjectAddPeopleMenu } from '@/components/app/project_add_people_menu';
import { relative_time } from '@/lib/api';
import { create_session, get_project, list_project_sessions } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project, Session } from '@/lib/api/types';

export function ProjectHomePage({ project_id }: { project_id: string }) {
  const project_query = useQuery({
    queryKey: query_keys.project(project_id),
    queryFn: () => get_project(project_id),
  });
  const chats_query = useQuery({
    queryKey: query_keys.sessions(project_id),
    queryFn: () => list_project_sessions(project_id),
  });

  if (project_query.isPending) {
    return <Skeleton className="mx-auto mt-10 h-96 w-[min(48rem,calc(100%-3rem))]" />;
  }
  if (project_query.isError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-destructive">{project_query.error.message}</p>
        <Link className="mt-3 inline-block text-sm underline" to="/projects">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <ProjectHomeHeader project={project_query.data} />
      <ProjectChatList
        error={chats_query.error}
        is_pending={chats_query.isPending}
        sessions={chats_query.data ?? []}
      />
    </div>
  );
}

function ProjectHomeHeader({ project }: { project: Project }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 truncate font-semibold text-2xl">{project.project_name}</h1>
        <div className="flex shrink-0 items-center gap-1">
          {project.can_manage && !project.is_workspace_default ? (
            <ProjectAddPeopleMenu project={project} />
          ) : null}
          <Link
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            to="/projects/$project_id/edit"
            params={{ project_id: project.project_id }}
          >
            <Pencil className="size-4" /> Edit
          </Link>
        </div>
      </div>
      <NewChatButton project_id={project.project_id} />
    </header>
  );
}

function NewChatButton({ project_id }: { project_id: string }) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const start_chat = useMutation({
    mutationFn: () => create_session({ project_id }),
    onSuccess: (session) => {
      query_client.invalidateQueries({ queryKey: query_keys.sessions() });
      navigate({ href: `/chats/${session.session_id}` });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button
      className="self-start"
      disabled={start_chat.isPending}
      onClick={() => start_chat.mutate()}
      type="button"
    >
      <MessageSquarePlus className="size-4" /> New chat
    </Button>
  );
}

function ProjectChatList({
  error,
  is_pending,
  sessions,
}: {
  error: Error | null;
  is_pending: boolean;
  sessions: Session[];
}) {
  if (is_pending) {
    return (
      <div className="flex flex-col gap-2">
        {['a', 'b', 'c'].map((key) => (
          <Skeleton className="h-11 w-full rounded-2xl" key={key} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 p-4 text-destructive text-sm">
        {error.message}
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center">
        <p className="font-medium">No chats yet.</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Start one above. Everyone in this project can read it.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {sessions.map((session) => (
        <li key={session.session_id}>
          <Link
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-accent"
            to="/chats/{-$session_id}"
            params={{ session_id: session.session_id }}
          >
            <MessageSquare aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {session.session_title ?? 'Untitled chat'}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {relative_time(session.last_message_time ?? session.last_updated_time ?? null)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
