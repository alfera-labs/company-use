import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

export type SignInRecipeDraft = {
  sign_in_page_url: string;
  login_request_url: string;
  username_field: string;
  password_field: string;
  success_field: string;
  success_value: string;
  rejected_fields: string;
  wait_minutes_field: string;
  anti_forgery_cookie: string;
  anti_forgery_header: string;
  session_cookies: string;
  session_lasts_minutes: string;
};

export const empty_sign_in_recipe: SignInRecipeDraft = {
  sign_in_page_url: '',
  login_request_url: '',
  username_field: 'username',
  password_field: 'password',
  success_field: 'result',
  success_value: 'success',
  rejected_fields: '',
  wait_minutes_field: '',
  anti_forgery_cookie: '',
  anti_forgery_header: '',
  session_cookies: '',
  session_lasts_minutes: '',
};

function split_names(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function generate_sign_in_recipe(
  draft: SignInRecipeDraft,
  always_send_headers: Record<string, string>,
) {
  const session_cookies = split_names(draft.session_cookies);
  if (!draft.login_request_url.trim() || session_cookies.length === 0) return null;

  return {
    exchange_kind: 'api_login' as const,
    stop_after_failed_attempts: 1,
    recipe: {
      ...(draft.sign_in_page_url.trim() ? { visit_first: draft.sign_in_page_url.trim() } : {}),
      post_credentials_to: draft.login_request_url.trim(),
      send_fields: {
        [draft.username_field.trim() || 'username']: 'username',
        [draft.password_field.trim() || 'password']: 'password',
      },
      ...(draft.anti_forgery_cookie.trim() && draft.anti_forgery_header.trim()
        ? {
            echo_cookie_into_header: {
              cookie_named: draft.anti_forgery_cookie.trim(),
              into_header: draft.anti_forgery_header.trim(),
            },
          }
        : {}),
      always_send_headers,
      successful_when_field: draft.success_field.trim() || 'result',
      successful_when_value: draft.success_value.trim() || 'success',
      rejected_when_any_field_present: split_names(draft.rejected_fields),
      ...(draft.wait_minutes_field.trim()
        ? { read_wait_minutes_from_field: draft.wait_minutes_field.trim() }
        : {}),
      ...(Number(draft.session_lasts_minutes) > 0
        ? { session_lasts_minutes: Number(draft.session_lasts_minutes) }
        : {}),
      keep_cookies_named: session_cookies,
    },
  };
}

export function SignInRecipeFields({
  draft,
  onChange,
}: {
  draft: SignInRecipeDraft;
  onChange: (draft: SignInRecipeDraft) => void;
}) {
  const [advanced_open, set_advanced_open] = useState(false);
  const page_id = useId();
  const request_id = useId();
  const cookies_id = useId();
  const set = (patch: Partial<SignInRecipeDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div>
        <p className="text-sm font-medium">Signing in</p>
        <p className="text-xs text-muted-foreground">
          The sign-in runs on the server, and the server keeps the session. Your password is never
          given to the agent and never enters its computer.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={page_id}>Sign-in page</Label>
        <Input
          id={page_id}
          placeholder="https://www.example.com/signin"
          value={draft.sign_in_page_url}
          onChange={(event) => set({ sign_in_page_url: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Visited first, so the site can hand us the cookie it expects back.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={request_id}>Sign-in request</Label>
        <Input
          id={request_id}
          placeholder="https://www.example.com/api/account/signin"
          value={draft.login_request_url}
          onChange={(event) => set({ login_request_url: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Open the site&apos;s sign-in page, sign in with the network panel recording, and copy the
          address of the request that carries the password.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={cookies_id}>Session cookies to keep</Label>
        <Input
          id={cookies_id}
          placeholder="session, XSRF-TOKEN"
          value={draft.session_cookies}
          onChange={(event) => set({ session_cookies: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          The cookie names that keep you signed in, from the same recording. Separate several with
          commas.
        </p>
      </div>

      <button
        type="button"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => set_advanced_open((open) => !open)}
      >
        {advanced_open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Fine-tune how this site answers
      </button>

      {advanced_open ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <RecipeField
            label="Username is sent as"
            value={draft.username_field}
            onChange={(value) => set({ username_field: value })}
          />
          <RecipeField
            label="Password is sent as"
            value={draft.password_field}
            onChange={(value) => set({ password_field: value })}
          />
          <RecipeField
            label="Success shows in field"
            hint="Many sites answer a wrong password with a 200, so we check the body instead."
            value={draft.success_field}
            onChange={(value) => set({ success_field: value })}
          />
          <RecipeField
            label="…with the value"
            value={draft.success_value}
            onChange={(value) => set({ success_value: value })}
          />
          <RecipeField
            label="Refusal shows in fields"
            hint="e.g. SIGNIN_FAIL. Separate several with commas."
            value={draft.rejected_fields}
            onChange={(value) => set({ rejected_fields: value })}
          />
          <RecipeField
            label="Wait-a-while field"
            hint="Carries the minutes the site asks us to wait, e.g. PASSWORD_WAIT. We honour it."
            value={draft.wait_minutes_field}
            onChange={(value) => set({ wait_minutes_field: value })}
          />
          <RecipeField
            label="Anti-forgery cookie"
            hint="Some sites want a cookie echoed back as a header, e.g. XSRF-TOKEN."
            value={draft.anti_forgery_cookie}
            onChange={(value) => set({ anti_forgery_cookie: value })}
          />
          <RecipeField
            label="…echoed into header"
            value={draft.anti_forgery_header}
            onChange={(value) => set({ anti_forgery_header: value })}
          />
          <RecipeField
            label="Session lasts (minutes)"
            hint="Only a hint for renewing early. A 401 is what really tells us."
            value={draft.session_lasts_minutes}
            onChange={(value) => set({ session_lasts_minutes: value })}
          />
        </div>
      ) : null}
    </div>
  );
}

function RecipeField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const field_id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={field_id}>{label}</Label>
      <Input id={field_id} value={value} onChange={(event) => onChange(event.target.value)} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
