import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { create_session } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function NewSessionForm({ basePath = '' }: { basePath?: string }) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const [session_title, set_session_title] = useState('');
  const [validation_error, set_validation_error] = useState<string | null>(null);

  const create = useMutation({
    mutationKey: ['create-session'],
    mutationFn: (title: string) => create_session(title ? { session_title: title } : {}),
    onSuccess: async (session) => {
      await query_client.invalidateQueries({ queryKey: query_keys.sessions() });
      toast.success('Session created');
      set_session_title('');
      navigate({ href: `${basePath}/sessions/${session.session_id}` });
    },
    onError: (error) => toast.error(format_error_message(error, 'Failed to create session')),
  });

  return (
    <form
      className="flex w-full max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const validated_title = validate_session_title(session_title);
        if (validated_title.error) {
          set_validation_error(validated_title.error);
          return;
        }

        set_validation_error(null);
        create.mutate(validated_title.value);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="session_title">Session title</Label>
        <Input
          id="session_title"
          placeholder="e.g. Ship the onboarding flow"
          value={session_title}
          onChange={(event) => set_session_title(event.currentTarget.value)}
        />
        {validation_error ? <p className="text-xs text-destructive">{validation_error}</p> : null}
      </div>
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Start a session'}
      </Button>
    </form>
  );
}

function validate_session_title(value: string) {
  const title = value.trim();
  if (title.length > 120) return { error: 'Keep the title under 120 characters', value: title };
  return { error: null, value: title };
}
