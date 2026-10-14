import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import {
  InstallButton,
  InstallError,
  InstallField,
} from '@/components/install_sign_in/install_form_parts';

export const shortest_password = 10;

type MadeAccount = { recovery_code: string };

type AccountEvents = {
  on_made: (recovery_code: string) => void;
  on_stopped: (code: string, message: string) => void;
};

function useMakeAccount(setup_token: string, events: AccountEvents) {
  const [fields, set_fields] = useState({ first_name: '', email: '', password: '' });
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    set_error('');
    const answer = await ask_install_step<MadeAccount>('/auth/setup/owner', {
      setup_token,
      email: fields.email,
      password: fields.password,
      ...(fields.first_name.trim() ? { first_name: fields.first_name.trim() } : {}),
    });
    set_busy(false);
    if (answer.ok) return events.on_made(answer.data.recovery_code);
    events.on_stopped(answer.code, answer.message);
    set_error(
      answer.code === 'validation_error'
        ? `Check the email, and use a password of ${shortest_password} characters or more.`
        : answer.message,
    );
  }

  const bind = (name: keyof typeof fields) => ({
    name,
    value: fields[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      set_fields({ ...fields, [name]: event.target.value }),
  });
  return { bind, busy, error, submit };
}

export function MakeAccountScreen({
  setup_token,
  connected_ai_name,
  ...events
}: AccountEvents & {
  setup_token: string;
  connected_ai_name: string | null;
}) {
  const form = useMakeAccount(setup_token, events);
  const saved_line = connected_ai_name ? `Your ${connected_ai_name} key is saved. ` : '';
  return (
    <AuthQuestion
      title="Make your account"
      subtitle={`${saved_line}You sign in to Alfera with this email and password, on any device.`}
    >
      <form method="post" onSubmit={form.submit}>
        <InstallField
          label="Your first name"
          autoComplete="given-name"
          {...form.bind('first_name')}
        />
        <InstallField
          label="Email"
          type="email"
          autoComplete="username"
          required
          {...form.bind('email')}
        />
        <InstallField
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={shortest_password}
          hint={`${shortest_password} characters or more.`}
          required
          {...form.bind('password')}
        />
        <InstallError message={form.error} />
        <InstallButton busy={form.busy} busy_label="Making your account…">
          Make my account
        </InstallButton>
      </form>
    </AuthQuestion>
  );
}
