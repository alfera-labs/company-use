import { api_login_recipe_schema } from '@coworker/core/credentials/api_login_recipe';
import {
  decide_whether_to_fetch,
  type LookupAddresses,
} from '@coworker/core/credentials/safe_outbound_url';
import { is_safe_icon_url } from '@coworker/core/credentials/website_icon';
import { z } from 'zod';

export const discovered_sign_in_schema = z
  .object({
    app_display_name: z.string().min(1).max(120),
    website_host: z.string().min(1).max(253),
    also_talks_to: z.array(z.string().min(1).max(253)).max(10).default([]),
    logo_url: z.string().url().max(2000).optional(),
    recipe: api_login_recipe_schema,
    sign_in_name_label: z.string().min(1).max(60).default('Email'),
    could_not_determine: z.array(z.string().max(200)).max(5).default([]),
  })
  .strict();

export type DiscoveredSignIn = z.infer<typeof discovered_sign_in_schema>;

export type DiscoveredSignInVerdict =
  | { accepted: true; allowed_hosts: string[] }
  | { accepted: false; because: string };

export async function validate_discovered_sign_in(input: {
  discovered: DiscoveredSignIn;
  lookup_addresses: LookupAddresses;
}): Promise<DiscoveredSignInVerdict> {
  const { discovered } = input;
  const allowed_hosts = [discovered.website_host, ...discovered.also_talks_to].map((host) =>
    host.trim().toLowerCase(),
  );

  const addresses = [
    discovered.recipe.post_credentials_to,
    discovered.recipe.visit_first,
    discovered.recipe.confirm_by_fetching,
  ].filter((url): url is string => typeof url === 'string');

  for (const url of addresses) {
    const verdict = await decide_whether_to_fetch({
      url,
      allowed_hosts,
      lookup_addresses: input.lookup_addresses,
    });
    if (!verdict.may_fetch) return { accepted: false, because: verdict.because };
  }

  if (discovered.logo_url && !is_safe_icon_url(discovered.logo_url)) {
    return { accepted: false, because: 'that logo address cannot be used' };
  }

  const wanted = Object.values(discovered.recipe.send_fields);
  const unfillable = wanted.filter((field) => field !== 'username' && field !== 'password');
  if (unfillable.length > 0) {
    return {
      accepted: false,
      because: `this sign-in also needs ${unfillable.join(', ')}, which the connect form cannot ask for`,
    };
  }
  if (!wanted.includes('password')) {
    return { accepted: false, because: 'no field in this sign-in carries the password' };
  }

  return { accepted: true, allowed_hosts: [...new Set(allowed_hosts)] };
}
