import { is_fallback_email } from '@coworker/core/db/queries/workspace_identity';

const free_mail_domains = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
]);

export function work_email_domain(email: string | null | undefined): string | null {
  const domain = email?.trim().toLowerCase().split('@')[1];
  if (!domain || free_mail_domains.has(domain) || is_fallback_email(domain)) return null;
  return domain;
}
