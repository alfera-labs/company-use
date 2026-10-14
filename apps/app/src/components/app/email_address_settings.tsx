import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Switch } from '@coworker/ui/components/switch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmailNotSetUpNote } from '@/components/app/channel_not_set_up_notes';
import { EmailAddressField } from '@/components/app/email_address_field';
import {
  create_workspace_email_address,
  get_workspace_email_address,
  update_workspace_email_address,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function EmailAddressSettings() {
  const query_client = useQueryClient();
  const address_query = useQuery({
    queryKey: query_keys.workspace_email_address(),
    queryFn: get_workspace_email_address,
  });

  const apply = useMutation({
    mutationFn: update_workspace_email_address,
    onSuccess: async (updated) => {
      query_client.setQueryData(query_keys.workspace_email_address(), updated);
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_email_address() });
    },
    onError: (error) => toast.error(format_error_message(error, 'Update failed')),
  });

  const create = useMutation({
    mutationFn: create_workspace_email_address,
    onSuccess: async (created) => {
      query_client.setQueryData(query_keys.workspace_email_address(), created);
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_email_address() });
      toast.success(`${created.email_address} is ready`);
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not create')),
  });

  if (address_query.isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (address_query.data && !address_query.data.available) {
    return <EmailNotSetUpNote />;
  }

  const state = address_query.data;
  if (!state?.email_address) {
    return <NoAddressYet on_create={() => create.mutate()} creating={create.isPending} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <EmailAddressField
        address={state.email_address}
        on_rename={(username) => apply.mutate({ username })}
        renaming={apply.isPending}
      />
      <SettingRow
        title="Email attribution"
        description={'Sign outbound mail as your AI agent — "Sent by Acme\'s AI agent on Alfera."'}
      >
        <Switch
          checked={state.attribution_enabled}
          disabled={apply.isPending}
          aria-label="Email attribution"
          onCheckedChange={(attribution_enabled) => apply.mutate({ attribution_enabled })}
        />
      </SettingRow>
      <SettingRow
        title="Inbox enabled"
        description={
          state.enabled
            ? 'Anyone who knows this address can start a conversation here.'
            : 'Mail to this address is recorded but never worked on.'
        }
      >
        <Button
          size="sm"
          variant={state.enabled ? 'destructive' : 'default'}
          disabled={apply.isPending}
          onClick={() => apply.mutate({ enabled: !state.enabled })}
        >
          {state.enabled ? 'Disable' : 'Enable'}
        </Button>
      </SettingRow>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function NoAddressYet({ on_create, creating }: { on_create: () => void; creating: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed px-4 py-6">
      <p className="text-sm text-muted-foreground">
        Give this workspace its own address so you can email Alfera the way you email a colleague —
        forward a thread, attach a file, and get the answer back as a reply.
      </p>
      <Button size="sm" disabled={creating} onClick={on_create}>
        Create email address
      </Button>
    </div>
  );
}
