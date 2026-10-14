import { Button } from '@coworker/ui/components/button';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { make_new_recovery_code } from '@/lib/api/sign_in_password';
import { copy_text } from '@/lib/copy_text';

function ShownOnce({ code, on_done }: { code: string; on_done: () => void }) {
  const [copied, set_copied] = useState<boolean | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <p>Your new recovery code. Alfera shows it only once. The old code does not work any more.</p>
      <output
        aria-label="Your new recovery code"
        className="select-all rounded-xl bg-muted px-4 py-3 font-mono tracking-[0.06em]"
      >
        {code}
      </output>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void copy_text(code).then(
              () => set_copied(true),
              () => set_copied(false),
            )
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" onClick={on_done}>
          I saved it
        </Button>
      </div>
      {copied === false ? (
        <p role="alert" className="text-destructive text-xs">
          Copy did not work. Select the code and copy it.
        </p>
      ) : null}
    </div>
  );
}

function PasswordAgain({ on_made }: { on_made: (code: string) => void }) {
  const [password, set_password] = useState('');
  const make = useMutation({
    mutationFn: () => make_new_recovery_code(password),
    onSuccess: (made) => on_made(made.recovery_code),
  });
  return (
    <form
      method="post"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (password) make.mutate();
      }}
    >
      <label className="flex flex-col gap-1">
        Type your password to make a new code
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => set_password(event.target.value)}
          className="h-10 rounded-xl bg-muted px-3 outline-none focus:ring-1 focus:ring-border"
        />
      </label>
      {make.error ? (
        <p role="alert" className="text-destructive text-xs">
          {make.error.message}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="self-start" disabled={!password || make.isPending}>
        {make.isPending ? 'Making the code…' : 'Make the new code'}
      </Button>
    </form>
  );
}

export function OwnRecoveryCodeSettings() {
  const [step, set_step] = useState<'closed' | 'password' | { code: string }>('closed');
  return (
    <section aria-label="Security" className="flex w-full flex-col gap-2">
      <h3 className="font-medium">Security</h3>
      <p className="text-muted-foreground">
        You sign in with your email and password. If you forget the password, your recovery code
        sets a new one. Make a new code when you lost the old one.
      </p>
      {step === 'closed' ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => set_step('password')}
        >
          Make a new recovery code
        </Button>
      ) : null}
      {step === 'password' ? <PasswordAgain on_made={(code) => set_step({ code })} /> : null}
      {typeof step === 'object' ? (
        <ShownOnce code={step.code} on_done={() => set_step('closed')} />
      ) : null}
    </section>
  );
}
