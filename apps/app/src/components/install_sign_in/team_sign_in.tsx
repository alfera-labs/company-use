import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import {
  InstallButton,
  InstallError,
  InstallField,
  InstallQuietLink,
} from '@/components/install_sign_in/install_form_parts';
import { PasswordRecovery } from '@/components/install_sign_in/password_recovery';

function usePasswordSignIn(return_to: string) {
  const [fields, set_fields] = useState({ email: '', password: '' });
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    set_error('');
    const answer = await ask_install_step('/auth/password/sign-in', fields);
    if (answer.ok) return window.location.assign(return_to);
    set_busy(false);
    set_fields({ ...fields, password: '' });
    set_error(
      answer.code === 'sign_in_refused' || answer.code === 'validation_error'
        ? 'That email and password do not match. Try again.'
        : answer.message,
    );
  }

  return { fields, set_fields, busy, error, submit };
}

function PasswordSignIn({ on_forgot, return_to }: { on_forgot: () => void; return_to: string }) {
  const form = usePasswordSignIn(return_to);
  return (
    <AuthQuestion title="Sign in to Alfera" subtitle="Use the email and password of your account.">
      <form method="post" onSubmit={form.submit}>
        <InstallField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          value={form.fields.email}
          onChange={(event) => form.set_fields({ ...form.fields, email: event.target.value })}
          required
        />
        <InstallField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={form.fields.password}
          onChange={(event) => form.set_fields({ ...form.fields, password: event.target.value })}
          required
        />
        <InstallError message={form.error} />
        <InstallButton busy={form.busy} busy_label="Signing in…">
          Sign in
        </InstallButton>
      </form>
      <InstallQuietLink label="Forgot your password?" on_click={on_forgot} />
      <p className="mt-6 text-center text-[14px] text-[#7a736c]">
        Got a sign-in link from your team? Open it in this browser.
      </p>
    </AuthQuestion>
  );
}

function SetupIsWaiting() {
  return (
    <AuthQuestion
      title="This Alfera is not set up yet"
      subtitle="Open the setup link from the page that made your server. Copy all of it, with the part after the # sign."
    />
  );
}

function SignInLinkNeeded() {
  return (
    <AuthQuestion
      title="This Alfera needs a sign-in link"
      subtitle="On the machine that runs it: ./alfera team link. If someone else runs it, ask them or an admin of the workspace for your link, and open it in this browser."
    />
  );
}

export function TeamSignIn({
  owner_password_is_set,
  setup_is_waiting,
  return_to,
}: {
  owner_password_is_set: boolean;
  setup_is_waiting: boolean;
  return_to: string;
}) {
  const [forgot, set_forgot] = useState(false);
  if (setup_is_waiting) return <SetupIsWaiting />;
  if (!owner_password_is_set) return <SignInLinkNeeded />;
  if (forgot) return <PasswordRecovery on_back={() => set_forgot(false)} />;
  return <PasswordSignIn on_forgot={() => set_forgot(true)} return_to={return_to} />;
}
