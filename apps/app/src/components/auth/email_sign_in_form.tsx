import { useEffect, useRef, useState } from 'react';
import {
  auth_button_classes as button_classes,
  auth_input_classes as input_classes,
} from '@/components/auth/auth_form_classes';

export function EmailSignInForm({
  return_to,
  mode = 'sign-in',
  submit_label = 'Sign In',
  verifying_email,
  initial_email,
}: {
  return_to: string;
  mode?: 'sign-in' | 'sign-up';
  submit_label?: string;
  verifying_email?: string;
  initial_email?: string;
}) {
  const [step, set_step] = useState<'email' | 'code'>(verifying_email ? 'code' : 'email');
  const [email, set_email] = useState(verifying_email ?? initial_email ?? '');
  const [code, set_code] = useState('');
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState('');
  const code_input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') code_input.current?.focus();
  }, [step]);

  const hosted_fallback_url = `/auth/sign-in?returnTo=${encodeURIComponent(return_to)}&email=${encodeURIComponent(email)}${mode === 'sign-up' ? '&screen=sign-up' : ''}`;

  async function submit_email(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    try {
      const response = await fetch('/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { ok: boolean };
      if (!result.ok) {
        window.location.href = hosted_fallback_url;
        return;
      }
      set_error('');
      set_step('code');
    } catch {
      window.location.href = hosted_fallback_url;
      return;
    }
    set_busy(false);
  }

  async function submit_code(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    try {
      // Two different codes reach this step: the one we asked WorkOS to send for an email sign-in,
      // and the one WorkOS sent itself to prove ownership before linking a new provider. They are
      // completed by different endpoints.
      const endpoint = verifying_email ? '/auth/email/verify-ownership' : '/auth/email/verify-code';
      const payload = verifying_email
        ? { code, returnTo: return_to }
        : { email, code, returnTo: return_to };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok: boolean; redirect?: string };
      if (result.ok && result.redirect) {
        window.location.href = result.redirect;
        return;
      }
      set_error('That code did not work. Check the digits or resend.');
    } catch {
      set_error('Something went wrong. Try again.');
    }
    set_busy(false);
    set_code('');
  }

  if (step === 'code') {
    return (
      <form onSubmit={submit_code}>
        <p className="mb-4 text-center text-[14.5px] text-[#7a736c]">
          We emailed a 6-digit code to <span className="font-semibold text-[#131110]">{email}</span>
        </p>
        <input
          className={`${input_classes} text-center tracking-[0.4em]`}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="000000"
          value={code}
          onChange={(event) => set_code(event.target.value.replace(/\D/g, ''))}
          ref={code_input}
          required
        />
        {error ? <p className="mt-3 text-center text-[13.5px] text-[#d03500]">{error}</p> : null}
        <button className={button_classes} type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        {verifying_email ? (
          <p className="mt-4 text-center text-[13.5px] text-[#a8a29b]">
            Nothing arrived? Check spam, or{' '}
            <a className="font-semibold text-brand" href="/sign-in">
              start over
            </a>
            .
          </p>
        ) : (
          <p className="mt-4 text-center text-[13.5px] text-[#a8a29b]">
            Nothing arrived?{' '}
            <button
              className="cursor-pointer font-semibold text-brand"
              type="button"
              onClick={(event) => {
                set_step('email');
                set_error('');
                void submit_email(event);
              }}
            >
              Resend code
            </button>
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit_email}>
      <input
        className={input_classes}
        type="email"
        name="email"
        placeholder="Email address"
        autoComplete="email"
        value={email}
        onChange={(event) => set_email(event.target.value)}
        required
      />
      <button className={button_classes} type="submit" disabled={busy}>
        {busy ? 'Sending code…' : submit_label}
      </button>
    </form>
  );
}
