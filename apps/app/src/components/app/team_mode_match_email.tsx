import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import {
  own_team_account_query_key,
  read_own_team_account,
  set_own_match_email,
} from '@/lib/api/team_mode';

const what_the_address_is_for =
  'The coworker uses it only to know it is you when you write to it in Slack or by mail. No mail is sent to it, and you do not sign in with it. Leave it empty if you use neither.';

/**
 * The one address a person gives so that the coworker knows it is them in Slack and in mail.
 * A person of a team install signs in with a link and has no address there, so without this
 * a Slack message or a mail of theirs is a stranger's. Only the person sets their own.
 */
export function TeamModeMatchEmail() {
  const field_id = useId();
  const query_client = useQueryClient();
  const account = useQuery({
    queryKey: own_team_account_query_key,
    queryFn: read_own_team_account,
  });
  const [typed, set_typed] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: set_own_match_email,
    onSuccess: (saved) => {
      query_client.setQueryData(own_team_account_query_key, saved);
      set_typed(null);
      toast.success(saved.match_email ? 'Saved your email' : 'Removed your email');
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not save this email')),
  });

  return (
    <form
      className="flex w-full max-w-md flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(typed?.trim() || null);
      }}
    >
      <Label htmlFor={field_id}>Your email in Slack and in mail</Label>
      <div className="flex gap-2">
        <Input
          id={field_id}
          type="email"
          maxLength={254}
          placeholder="you@example.com"
          value={typed ?? account.data?.match_email ?? ''}
          onChange={(event) => set_typed(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={typed === null || save.isPending}
        >
          Save email
        </Button>
      </div>
      <p className="text-muted-foreground">{what_the_address_is_for}</p>
    </form>
  );
}
