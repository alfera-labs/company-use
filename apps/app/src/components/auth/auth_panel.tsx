import { terms_and_privacy_urls } from '@coworker/config/hosted_defaults';
import { BrandLogo } from '@/components/app/brand_logo';
import { EmailSignIn } from '@/components/auth/email_sign_in';
import { EmailSignInForm } from '@/components/auth/email_sign_in_form';
import { GoogleLogo, SlackLogo } from '@/components/auth/provider_logos';

export type AuthMode = 'sign-in' | 'sign-up';

const mode_copy = {
  'sign-in': {
    submit_label: 'Sign In',
    shows_email_form: true,
    footer_question: 'Need an account?',
    footer_link_label: 'Sign up',
    footer_href: '/sign-up',
    consent_verb: 'signing in',
  },
  'sign-up': {
    submit_label: 'Sign Up',
    // Email works on both doors. It depends on Magic Auth being ON in WorkOS — with it off,
    // the form dead-ends on the hosted fallback, so this ships together with that toggle.
    shows_email_form: true,
    footer_question: 'Have an account?',
    footer_link_label: 'Sign in',
    footer_href: '/sign-in',
    consent_verb: 'creating an account',
  },
} as const satisfies Record<AuthMode, { shows_email_form: boolean } & Record<string, unknown>>;

const provider_pill_classes =
  'flex h-[62px] w-full items-center justify-center gap-3 rounded-full border border-[#e9e5e0] bg-white text-[16.5px] font-medium shadow-[0_1px_2px_rgba(19,17,16,0.05),0_4px_12px_-4px_rgba(19,17,16,0.06)] transition-all duration-150 hover:-translate-y-px hover:border-[#ddd8d2] hover:shadow-[0_2px_4px_rgba(19,17,16,0.06),0_8px_18px_-6px_rgba(19,17,16,0.1)]';

export function AuthPanel({
  mode,
  return_to,
  verifying_email,
}: {
  mode: AuthMode;
  return_to: string;
  verifying_email?: string;
}) {
  const copy = mode_copy[mode];
  const query = `?returnTo=${encodeURIComponent(return_to)}`;

  if (verifying_email) {
    return (
      <AuthQuestion
        title={
          <>
            Confirm it's <span className="text-brand">you</span>
          </>
        }
        subtitle="This is the first time this account has signed in this way, so we need to check the address belongs to you."
      >
        <EmailSignInForm
          mode={mode}
          return_to={return_to}
          submit_label={copy.submit_label}
          verifying_email={verifying_email}
        />
      </AuthQuestion>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#fafaf8] font-sans text-[#131110] antialiased">
      {/* `my-auto` rather than `justify-center` on the parent: a flex container that centers
          content taller than the viewport pushes the overflow past the top edge, where it cannot be
          scrolled back into view. Auto margins collapse instead, so a short window scrolls. */}
      <main className="mx-auto my-auto flex w-full max-w-[520px] flex-col px-6 py-10">
        <BrandLogo className="h-8 w-auto self-start text-[#131110]" />

        <h1 className="mt-9 text-[33px] font-semibold leading-tight tracking-[-0.022em]">
          Meet your first <span className="text-brand">AI coworker</span>
        </h1>

        <a className={`mt-10 ${provider_pill_classes}`} href={`/auth/sign-in/google${query}`}>
          <GoogleLogo />
          Continue with Google
        </a>

        <a className={`mt-4 ${provider_pill_classes}`} href={`/auth/sign-in/slack${query}`}>
          <SlackLogo />
          Continue with Slack
        </a>

        {copy.shows_email_form ? (
          <>
            <div className="my-7 flex items-center gap-4 text-[12.5px] font-semibold tracking-[0.08em] text-[#9b9691]">
              <span className="h-px flex-1 bg-[#e9e6e3]" aria-hidden="true" />
              OR
              <span className="h-px flex-1 bg-[#e9e6e3]" aria-hidden="true" />
            </div>
            <EmailSignIn mode={mode} return_to={return_to} submit_label={copy.submit_label} />
          </>
        ) : null}

        <p className="mt-8 text-center text-[15px] text-[#7a736c]">
          {copy.footer_question}{' '}
          <a className="font-semibold text-brand" href={`${copy.footer_href}${query}`}>
            {copy.footer_link_label}
          </a>
        </p>

        <TermsAndPrivacyNote consent_verb={copy.consent_verb} />
      </main>
    </div>
  );
}

export function AuthQuestion({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#fafaf8] font-sans text-[#131110] antialiased">
      <main className="mx-auto my-auto flex w-full max-w-[520px] flex-col px-6 py-10">
        <BrandLogo className="h-8 w-auto self-start text-[#131110]" />
        <h1 className="mt-9 text-[33px] font-semibold leading-tight tracking-[-0.022em]">
          {title}
        </h1>
        <p className="mt-3 mb-8 text-[15px] leading-relaxed text-[#7a736c]">{subtitle}</p>
        {children}
      </main>
    </div>
  );
}

function TermsAndPrivacyNote({ consent_verb }: { consent_verb: string }) {
  if (!terms_and_privacy_urls) return null;
  return (
    <p className="mt-10 text-center text-[13.5px] leading-relaxed text-[#a8a29b]">
      By {consent_verb}, you agree to the Alfera{' '}
      <a
        className="underline underline-offset-2 hover:text-[#7a736c]"
        href={terms_and_privacy_urls.terms}
      >
        Terms of Service
      </a>{' '}
      and{' '}
      <a
        className="underline underline-offset-2 hover:text-[#7a736c]"
        href={terms_and_privacy_urls.privacy}
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
