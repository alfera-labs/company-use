import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ProjectSection } from '@/components/app/project_section';
import { list_project_channels, remove_project_channel } from '@/lib/api/endpoints';
import type { ProjectChannel } from '@/lib/api/types';
import { settings_section_path } from '@/lib/settings_navigation';

// The Slack channels that work in this project. A channel is put here from its own row in
// Settings › Channels; this list only shows them and takes one out.
export function ProjectChannelsSection({
  project_id,
  can_manage,
}: {
  project_id: string;
  can_manage: boolean;
}) {
  const channels_query = useQuery({
    queryKey: ['project-channels', project_id],
    queryFn: () => list_project_channels(project_id),
  });
  const channels = channels_query.data ?? [];

  return (
    <ProjectSection
      title="Slack channels"
      description="Conversations in these channels use this project's instructions and connections."
    >
      {channels_query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : channels_query.isError ? (
        <p className="text-destructive text-sm">{channels_query.error.message}</p>
      ) : channels.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No Slack channels yet. Pick this project for a channel in{' '}
          <Link className="underline hover:text-foreground" to={settings_section_path('channels')}>
            Settings › Channels
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {channels.map((channel) => (
            <ProjectChannelRow
              key={channel.channel_route_id}
              can_manage={can_manage}
              channel={channel}
              project_id={project_id}
            />
          ))}
        </ul>
      )}
    </ProjectSection>
  );
}

function ProjectChannelRow({
  can_manage,
  channel,
  project_id,
}: {
  can_manage: boolean;
  channel: ProjectChannel;
  project_id: string;
}) {
  const query_client = useQueryClient();
  const name = `#${channel.channel_name ?? channel.external_conversation_id ?? 'channel'}`;
  const remove = useMutation({
    mutationFn: () =>
      remove_project_channel({ project_id, channel_route_id: channel.channel_route_id }),
    onSuccess: async () => {
      toast.success(`${name} is no longer in this project`);
      await Promise.all([
        query_client.invalidateQueries({ queryKey: ['project-channels', project_id] }),
        query_client.invalidateQueries({ queryKey: ['slack-channel-settings'] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message || 'Could not remove the channel'),
  });

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {can_manage ? (
        <Button
          aria-label={`Remove ${name} from this project`}
          disabled={remove.isPending}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Remove
        </Button>
      ) : null}
    </li>
  );
}
