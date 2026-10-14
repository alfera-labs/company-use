export type EmailSenderAuthentication = {
  dmarc: EmailAuthenticationVerdict;
  spf: EmailAuthenticationVerdict;
  dkim: EmailAuthenticationVerdict;
};

type EmailAuthenticationVerdict = 'pass' | 'fail' | 'none';

const empty_authentication: EmailSenderAuthentication = {
  dmarc: 'none',
  spf: 'none',
  dkim: 'none',
};

type ProviderVerdicts = {
  spf?: string | null | undefined;
  dkim?: string | null | undefined;
  dmarc?: string | null | undefined;
};

/**
 * The receiving provider checks the sender itself and reports its verdicts. Those decide when
 * it sent them, because the header is text inside the message and the verdicts are not. The
 * header is read only for a provider answer that carries no verdicts.
 */
export function read_email_sender_authentication(
  authentication_results: unknown,
  provider_verdicts?: ProviderVerdicts | null,
): EmailSenderAuthentication {
  if (provider_verdicts) {
    return {
      dmarc: verdict_of(provider_verdicts.dmarc),
      spf: verdict_of(provider_verdicts.spf),
      dkim: verdict_of(provider_verdicts.dkim),
    };
  }
  if (typeof authentication_results !== 'string') return empty_authentication;

  return {
    dmarc: read_verdict(authentication_results, 'dmarc'),
    spf: read_verdict(authentication_results, 'spf'),
    dkim: read_verdict(authentication_results, 'dkim'),
  };
}

export function sender_domain_is_authenticated(authentication: EmailSenderAuthentication): boolean {
  return authentication.dmarc === 'pass';
}

export function sender_is_trusted_member(
  input: { from_email: string; sender_authentication: EmailSenderAuthentication },
  member_emails: string[],
): boolean {
  return (
    member_emails.includes(input.from_email) &&
    sender_domain_is_authenticated(input.sender_authentication)
  );
}

function read_verdict(
  authentication_results: string,
  method: 'dmarc' | 'spf' | 'dkim',
): EmailAuthenticationVerdict {
  const match = new RegExp(`(?:^|[;\\s])${method}\\s*=\\s*([a-z]+)`, 'i').exec(
    authentication_results,
  );
  return verdict_of(match?.[1]);
}

function verdict_of(word: string | null | undefined): EmailAuthenticationVerdict {
  const verdict = word?.toLowerCase();
  if (verdict === 'pass') return 'pass';
  if (verdict === 'fail' || verdict === 'softfail' || verdict === 'permerror') return 'fail';
  return 'none';
}
