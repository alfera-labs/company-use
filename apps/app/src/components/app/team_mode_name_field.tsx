import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { use_team } from '@/components/app/use_team_mode';
import { set_my_team_name, team_query_key } from '@/lib/api/team_mode';
import { useAuth } from '@/lib/auth_client';

/** The person's own name on a team install: the team page, the sidebar and the coworker use it. */
export function TeamModeNameField() {
  const team = use_team().data;
  const me = team?.members.find((member) => member.user_id === team.viewer_user_id);
  if (!me) return null;
  return <OwnNameForm key={me.first_name} saved_name={me.first_name ?? ''} />;
}

function OwnNameForm({ saved_name }: { saved_name: string }) {
  const router = useRouter();
  const query_client = useQueryClient();
  const { refreshAuth: reload_the_name_in_the_sidebar } = useAuth();
  const field_id = useId();
  const [name, set_name] = useState(saved_name);
  const new_name = name.trim();
  const save = useMutation({
    mutationFn: set_my_team_name,
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: team_query_key });
      await Promise.all([router.invalidate(), reload_the_name_in_the_sidebar()]);
      toast.success('Your name is saved');
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not save your name')),
  });

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (new_name && new_name !== saved_name) save.mutate(new_name);
      }}
    >
      <label className="font-medium" htmlFor={field_id}>
        Your name
      </label>
      <div className="flex gap-2">
        <Input
          id={field_id}
          maxLength={120}
          value={name}
          onChange={(event) => set_name(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!new_name || new_name === saved_name || save.isPending}
        >
          Save name
        </Button>
      </div>
    </form>
  );
}
