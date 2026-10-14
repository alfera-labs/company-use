import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useId, useState } from 'react';
import {
  type CompleteAppSignInResult,
  complete_app_sign_in,
  get_app_sign_in_form,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function AppSignInForm({ connection_id }: { connection_id: string }) {
  const [sign_in_name, set_sign_in_name] = useState('');
  const [password, set_password] = useState('');
  const name_id = useId();
  const password_id = useId();

  const form_query = useQuery({
    queryKey: query_keys.app_sign_in(connection_id),
    queryFn: () => get_app_sign_in_form(connection_id),
  });

  const connect = useMutation({
    mutationFn: (): Promise<CompleteAppSignInResult> =>
      complete_app_sign_in({ connection_id, sign_in_name, password }),
  });

  if (form_query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (form_query.isError || !form_query.data) {
    return (
      <p className="text-sm text-destructive">
        We could not find that connection. It may have been completed or removed already.
      </p>
    );
  }

  const form = form_query.data;
  const result = connect.data;

  if (result?.connected) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-8 text-brand-ink" />
        <p className="font-medium">{form.app_display_name} is connected.</p>
        <p className="text-sm text-muted-foreground">
          Your agent can now use it. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        {form.logo_url ? (
          <img
            src={form.logo_url}
            alt=""
            className="size-10 rounded-2xl border border-border object-contain"
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-2xl border border-border text-sm font-medium">
            {form.app_display_name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <p className="font-medium">{form.app_display_name}</p>
          <p className="text-xs text-muted-foreground">{form.website_host}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={name_id}>{form.sign_in_name_label}</Label>
        <Input
          id={name_id}
          autoComplete="off"
          value={sign_in_name}
          onChange={(event) => set_sign_in_name(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={password_id}>Password</Label>
        <Input
          id={password_id}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => set_password(event.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Your password is used once, by the server, to sign in to {form.website_host}. Your agent
        never sees it and it never reaches the computer your agent works on.
      </p>

      {form.could_not_determine.length > 0 ? (
        <div className="rounded-2xl border border-border p-3">
          <p className="text-xs font-medium">We could not work out everything about this site:</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            {form.could_not_determine.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            It may still work. If it does not, connect it by hand from Integrations.
          </p>
        </div>
      ) : null}

      {result && !result.connected ? (
        <div className="rounded-2xl border border-destructive/40 p-3">
          <p className="text-sm text-destructive">{result.message}</p>
          {result.retry_allowed_after_time ? (
            <p className="mt-1 text-xs text-muted-foreground">
              That site asked us to wait. Try again after{' '}
              {new Date(result.retry_allowed_after_time).toLocaleTimeString()}.
            </p>
          ) : null}
        </div>
      ) : null}

      {connect.isError ? (
        <p className="text-sm text-destructive">We could not reach that site. Please try again.</p>
      ) : null}

      <Button
        disabled={connect.isPending || !sign_in_name.trim() || !password}
        onClick={() => connect.mutate()}
      >
        {connect.isPending ? 'Signing in…' : `Connect ${form.app_display_name}`}
      </Button>
    </div>
  );
}
