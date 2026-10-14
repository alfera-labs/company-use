import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import {
  auth_button_classes,
  auth_input_classes,
  auth_quiet_link_classes,
} from '@/components/auth/auth_form_classes';

export function InstallField(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string },
) {
  const { label, hint, className, ...input } = props;
  const id = useId();
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={id} className="mb-2 block px-1 text-[14px] font-medium">
        {label}
      </label>
      <input
        id={id}
        className={`${auth_input_classes} ${className ?? ''}`}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 px-1 text-[13.5px] text-[#7a736c]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function InstallError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 text-center text-[14px] text-[#d03500]">
      {message}
    </p>
  );
}

export function InstallButton({
  busy,
  busy_label,
  children,
  disabled,
  on_click,
}: {
  busy: boolean;
  busy_label: string;
  children: ReactNode;
  disabled?: boolean;
  on_click?: () => void;
}) {
  return (
    <button
      className={auth_button_classes}
      type={on_click ? 'button' : 'submit'}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={on_click}
    >
      {busy ? busy_label : children}
    </button>
  );
}

export function InstallQuietLink({ label, on_click }: { label: string; on_click: () => void }) {
  return (
    <p className="mt-6 text-center text-[15px]">
      <button type="button" className={auth_quiet_link_classes} onClick={on_click}>
        {label}
      </button>
    </p>
  );
}
