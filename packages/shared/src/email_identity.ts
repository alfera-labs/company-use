// The person behind an address, for grants that must land once per human. Gmail delivers
// sample.mail.box@, s.ample.mai.lbox@ and samplemailbox+7@ to one inbox, so a sign-up flow that
// trusts the raw string hands the same person unlimited accounts.
const dotless_domains = new Set(['gmail.com', 'googlemail.com']);

export function normalize_email_identity(email: string) {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (!local || !domain) return null;

  const canonical_domain = domain === 'googlemail.com' ? 'gmail.com' : domain;
  const tagless_local = local.split('+')[0] ?? '';
  const canonical_local = dotless_domains.has(canonical_domain)
    ? tagless_local.replaceAll('.', '')
    : tagless_local;

  return canonical_local ? `${canonical_local}@${canonical_domain}` : null;
}
