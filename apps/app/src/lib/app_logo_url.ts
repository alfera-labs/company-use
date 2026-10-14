import { logo_dev_publishable_token } from '@coworker/config/hosted_defaults';

export function app_logo_url(domain: string | undefined) {
  return domain && logo_dev_publishable_token
    ? `https://img.logo.dev/${domain}?token=${logo_dev_publishable_token}&size=64&format=png`
    : '';
}
