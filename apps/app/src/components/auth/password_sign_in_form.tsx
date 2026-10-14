import { useState } from 'react';
import { auth_button_classes, auth_input_classes } from '@/components/auth/auth_form_classes';

async function request_password_sign_in(body: {
  email: string;
  password: string;
  returnTo: string;
}): Promise<string | null> {
  const response = await fetch('/auth/email/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok: boolean; redirect?: string };
  return result.ok && result.redirect ? result.redirect : null;
}

function usePasswordSignIn(email: string, return_to: string) {
  const [password, set_password] = useState('');
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    try {
      const redirect = await request_password_sign_in({ email, password, returnTo: return_to });
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      set_error('That password did not work. Try again, or get a code by email.');
    } catch {
      set_error('Something went wrong. Try again.');
    }
    set_busy(false);
    set_password('');
  }

  return { password, set_password, busy, error, submit };
}

export function PasswordSignInForm({ email, return_to }: { email: string; return_to: string }) {
  const form = usePasswordSignIn(email, return_to);
  return (
    <form onSubmit={form.submit}>
      <p className="mb-4 text-center text-[14.5px] text-[#7a736c]">
        Enter the password for <span className="font-semibold text-[#131110]">{email}</span>
      </p>
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <input
        className={auth_input_classes}
        type="password"
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        value={form.password}
        onChange={(event) => form.set_password(event.target.value)}
        ref={(input) => input?.focus()}
        required
      />
      {form.error ? (
        <p className="mt-3 text-center text-[13.5px] text-[#d03500]">{form.error}</p>
      ) : null}
      <button className={auth_button_classes} type="submit" disabled={form.busy}>
        {form.busy ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}
