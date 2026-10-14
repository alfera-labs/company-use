import { useState } from 'react';
import { AuthQuestion } from '@/components/auth/auth_panel';
import { ask_install_step } from '@/components/install_sign_in/ask_install_step';
import {
  InstallButton,
  InstallError,
  InstallField,
  InstallQuietLink,
} from '@/components/install_sign_in/install_form_parts';
import { shortest_password } from '@/components/install_sign_in/make_account_screen';
import { RecoveryCodeScreen } from '@/components/install_sign_in/recovery_code_screen';

type Recovered = { recovery_code: string };

function usePasswordRecovery(on_recovered: (recovery_code: string) => void) {
  const [fields, set_fields] = useState({ email: '', recovery_code: '', new_password: '' });
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    set_busy(true);
    set_error('');
    const answer = await ask_install_step<Recovered>('/auth/password/recover', fields);
    set_busy(false);
    if (answer.ok) return on_recovered(answer.data.recovery_code);
    if (answer.code === 'recovery_refused') {
      return set_error(
        'That email and recovery code do not match. Check the code, then try again.',
      );
    }
    set_error(
      answer.code === 'validation_error'
        ? `Check the fields. The new password needs ${shortest_password} characters or more.`
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

function RecoveryForm({
  on_back,
  on_recovered,
}: {
  on_back: () => void;
  on_recovered: (recovery_code: string) => void;
}) {
  const form = usePasswordRecovery(on_recovered);
  return (
    <AuthQuestion
      title="Set a new password"
      subtitle="Use the recovery code you saved when you made your account."
    >
      <form method="post" onSubmit={form.submit}>
        <InstallField
          label="Email"
          type="email"
          autoComplete="username"
          {...form.bind('email')}
          required
        />
        <InstallField
          label="Recovery code"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          {...form.bind('recovery_code')}
          required
        />
        <InstallField
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={shortest_password}
          hint={`${shortest_password} characters or more.`}
          {...form.bind('new_password')}
          required
        />
        <InstallError message={form.error} />
        <InstallButton busy={form.busy} busy_label="Setting your new password…">
          Set new password
        </InstallButton>
      </form>
      <InstallQuietLink label="Back to sign in" on_click={on_back} />
    </AuthQuestion>
  );
}

export function PasswordRecovery({ on_back }: { on_back: () => void }) {
  const [new_code, set_new_code] = useState<string | null>(null);
  if (new_code) {
    return (
      <RecoveryCodeScreen
        title="Save your new recovery code"
        subtitle="Your password is changed and every other device is signed out. The old recovery code does not work any more. Alfera shows this new one only once."
        recovery_code={new_code}
        on_done={() => window.location.assign('/')}
      />
    );
  }
  return <RecoveryForm on_back={on_back} on_recovered={set_new_code} />;
}
