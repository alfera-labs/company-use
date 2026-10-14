// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { list_projects, set_slack_channel_access } from '@/lib/api/endpoints';
import type { Project } from '@/lib/api/types';

type ChannelWithProject = {
  id: string;
  name: string;
  project_id: string | null;
  is_enabled: boolean;
};

const no_project_value = 'none';

// Which project a Slack channel works in. #sales in Sales means the agent there reads Sales'
// instructions and uses only what Sales was given. Picking a project also turns the channel on;
// "No project" leaves it on or off as it was.
export function ChannelProjectSelect({
  channel,
  disabled,
}: {
  channel: ChannelWithProject;
  disabled: boolean;
}) {
  const projects_query = useQuery({ queryKey: ['projects', ''], queryFn: () => list_projects() });
  const projects = (projects_query.data ?? []).filter(
    (project) => project.personal_for_user_id === null,
  );
  const change = use_channel_project_change(channel, projects);

  if (projects_query.isPending) return <Skeleton className="h-7 w-40" />;

  return (
    <Select
      items={project_choice_labels(projects, channel.project_id)}
      value={channel.project_id ?? no_project_value}
      disabled={disabled || change.isPending}
      onValueChange={(value) =>
        change.mutate(value === no_project_value ? null : (value as string))
      }
    >
      <SelectTrigger aria-label={`Project for #${channel.name}`} className="w-40" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={no_project_value}>No project</SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.project_id} value={project.project_id}>
            {project.project_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function use_channel_project_change(channel: ChannelWithProject, projects: Project[]) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: (project_id: string | null) =>
      set_slack_channel_access({
        channel_id: channel.id,
        enabled: project_id === null ? channel.is_enabled : true,
        project_id,
        channel_name: channel.name,
      }),
    onSuccess: async (_, project_id) => {
      toast.success(project_change_message(channel.name, project_id, projects));
      await Promise.all([
        query_client.invalidateQueries({ queryKey: ['slack-channel-settings'] }),
        query_client.invalidateQueries({ queryKey: ['project-channels'] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message || 'Could not change the project'),
  });
}

// The channel may sit in a project this person cannot see; the control still names that state
// instead of showing a raw id.
function project_choice_labels(projects: Project[], current_project_id: string | null) {
  const labels: Record<string, string> = { [no_project_value]: 'No project' };
  for (const project of projects) labels[project.project_id] = project.project_name;
  if (current_project_id && !(current_project_id in labels)) {
    labels[current_project_id] = 'Another project';
  }
  return labels;
}

export function project_change_message(
  channel_name: string,
  project_id: string | null,
  projects: Project[],
) {
  if (project_id === null) return `#${channel_name} is no longer in a project`;
  const project = projects.find((one) => one.project_id === project_id);
  return `#${channel_name} now works in ${project?.project_name ?? 'the project'}`;
}
