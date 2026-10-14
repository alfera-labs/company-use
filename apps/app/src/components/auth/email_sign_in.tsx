import { useState } from 'react';
import {
  auth_button_classes,
  auth_input_classes,
  auth_quiet_link_classes,
} from '@/components/auth/auth_form_classes';
import { EmailSignInForm } from '@/components/auth/email_sign_in_form';
import { PasswordSignInForm } from '@/components/auth/password_sign_in_form';

type Step = 'email' | 'password' | 'code';

/** Sign-in by email: the address first, then its password, with an emailed code as the other way in. */
export function EmailSignIn({
  mode,
  return_to,
  submit_label,
}: {
  mode: 'sign-in' | 'sign-up';
  return_to: string;
  submit_label: string;
}) {
  const [step, set_step] = useState<Step>(mode === 'sign-up' ? 'code' : 'email');
  const [email, set_email] = useState('');

  if (step === 'code') {
    return (
      <EmailSignInForm
        mode={mode}
        return_to={return_to}
        submit_label={mode === 'sign-up' ? submit_label : 'Email me a code'}
        initial_email={email}
      />
    );
  }
  if (step === 'password') {
    return (
      <>
        <PasswordSignInForm email={email} return_to={return_to} />
        <StepLink label="Email me a code instead" on_click={() => set_step('code')} />
        <StepLink label="Use a different email" on_click={() => set_step('email')} />
      </>
    );
  }
  return <EmailStep email={email} on_email={set_email} on_continue={() => set_step('password')} />;
}

function EmailStep({
  email,
  on_email,
  on_continue,
}: {
  email: string;
  on_email: (email: string) => void;
  on_continue: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        on_continue();
      }}
    >
      <input
        className={auth_input_classes}
        type="email"
        name="email"
        placeholder="Email address"
        autoComplete="email"
        value={email}
        onChange={(event) => on_email(event.target.value)}
        required
      />
      <button className={auth_button_classes} type="submit">
        Continue
      </button>
    </form>
  );
}

function StepLink({ label, on_click }: { label: string; on_click: () => void }) {
  return (
    <p className="mt-4 text-center text-[13.5px] text-[#a8a29b]">
      <button className={auth_quiet_link_classes} type="button" onClick={on_click}>
        {label}
      </button>
    </p>
  );
}
