import { Avatar, AvatarFallback } from '@coworker/ui/components/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Building2, FolderClosed } from 'lucide-react';
import { memo } from 'react';
import { room_label } from '@/components/app/chat_room_label';
import { user_initials } from '@/components/app/user_initials';
import { get_current_workspace, list_projects } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';
import { useAuth } from '@/lib/auth_client';

const personal_value = 'personal';

export const ChatProjectPicker = memo(function ChatProjectPicker({
  project_id,
  onProjectChange,
}: {
  project_id: string | null;
  onProjectChange: (project_id: string | null) => void;
}) {
  const { user } = useAuth();
  const projects_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  return (
    <ChatProjectPickerControl
      project_id={project_id}
      projects={(projects_query.data ?? []).filter(
        (project) => project.personal_for_user_id === null,
      )}
      {...(workspace_query.data?.workspace_name
        ? { workspace_name: workspace_query.data.workspace_name }
        : {})}
      is_error={projects_query.isError || workspace_query.isError}
      personal_initials={user_initials(user?.firstName, user?.lastName, user?.email)}
      onProjectChange={onProjectChange}
      onRetry={() => void Promise.all([projects_query.refetch(), workspace_query.refetch()])}
    />
  );
});

export function ChatProjectPickerControl({
  project_id,
  projects,
  workspace_name,
  is_error = false,
  personal_initials = 'U',
  onProjectChange,
  onRetry,
}: {
  project_id: string | null;
  projects: readonly Project[];
  workspace_name?: string;
  is_error?: boolean;
  personal_initials?: string;
  onProjectChange: (project_id: string | null) => void;
  onRetry?: () => void;
}) {
  const selected_label = project_id ? room_label(project_id, projects, workspace_name) : 'Personal';
  const ordered_projects = order_chat_projects(projects);
  const company_project = ordered_projects[0]?.is_workspace_default
    ? ordered_projects[0]
    : undefined;
  const custom_projects = company_project ? ordered_projects.slice(1) : ordered_projects;
  const selected_project = projects.find((project) => project.project_id === project_id);
  const SelectedIcon = selected_project?.is_workspace_default ? Building2 : FolderClosed;
  const items = {
    [personal_value]: 'Personal',
    ...Object.fromEntries(
      ordered_projects.map((project) => [
        project.project_id,
        room_label(project.project_id, projects, workspace_name),
      ]),
    ),
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        items={items}
        value={project_id ?? personal_value}
        onValueChange={(value) => {
          if (value !== null) onProjectChange(value === personal_value ? null : value);
        }}
      >
        <SelectTrigger
          aria-label={`Chat project: ${selected_label}`}
          className="!h-9 max-w-full !bg-transparent rounded-full px-2 text-muted-foreground shadow-none hover:!bg-transparent hover:text-foreground data-[popup-open]:!bg-transparent *:data-[slot=select-value]:block sm:max-w-48"
        >
          {project_id ? (
            <SelectedIcon aria-hidden="true" className="size-4" />
          ) : (
            <PersonalAvatar initials={personal_initials} />
          )}
          <SelectValue className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent align="end" className="min-w-52 rounded-2xl p-1">
          <SelectItem value={personal_value}>
            <span className="flex items-center gap-2">
              <PersonalAvatar initials={personal_initials} />
              Personal
            </span>
          </SelectItem>
          {company_project ? (
            <SelectItem value={company_project.project_id}>
              <span className="flex items-center gap-2">
                <Building2 className="size-3.5" />
                {room_label(company_project.project_id, projects, workspace_name)}
              </span>
            </SelectItem>
          ) : null}
          {company_project && custom_projects.length > 0 ? <SelectSeparator /> : null}
          {custom_projects.map((project) => {
            return (
              <SelectItem key={project.project_id} value={project.project_id}>
                <span className="flex items-center gap-2">
                  <FolderClosed className="size-3.5" />
                  {room_label(project.project_id, projects, workspace_name)}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {is_error && onRetry ? (
        <button className="text-xs text-destructive underline" type="button" onClick={onRetry}>
          Retry projects
        </button>
      ) : null}
    </div>
  );
}

export function order_chat_projects(projects: readonly Project[]) {
  const company_project = projects.find((project) => project.is_workspace_default);
  return company_project
    ? [company_project, ...projects.filter((project) => project !== company_project)]
    : [...projects];
}

function PersonalAvatar({ initials }: { initials: string }) {
  return (
    <Avatar aria-hidden="true" className="size-5 shrink-0 border border-border bg-muted">
      <AvatarFallback className="grid place-items-center bg-muted text-center font-medium text-[9px] leading-none text-muted-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
