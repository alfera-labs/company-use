import { env } from '@coworker/config';
import { public_env } from '@coworker/config/public_env';

export type WebCallAddressSettings = {
  api_public_url: string | undefined;
  api_url: string;
  api_url_on_this_machine: string;
  self_hosted: boolean;
};

export type WebCallAddress = { webhook_url: string; reaches_outside_this_machine: boolean };

export const address_only_on_this_machine_note =
  'This address works only on the machine this install runs on. A caller outside this machine needs a public address: run ./alfera add https.';

function read_web_call_address_settings(): WebCallAddressSettings {
  return {
    api_public_url: env.API_PUBLIC_URL,
    api_url: env.API_URL,
    api_url_on_this_machine: public_env.NEXT_PUBLIC_API_URL,
    self_hosted: env.COWORKER_SELF_HOSTED,
  };
}

/**
 * The one place that builds the address a web-call trigger is called at, for the screen and for
 * the coworker's tool answer. The public API address wins. The hosted product has no other
 * address than its API one. A self-host with no public address answers the address the browser
 * of this machine uses, never the name the containers call each other by, and says that it does
 * not reach outside this machine.
 */
export function read_web_call_address(
  trigger_id: string,
  settings: WebCallAddressSettings = read_web_call_address_settings(),
): WebCallAddress {
  const public_origin = settings.api_public_url ?? (settings.self_hosted ? null : settings.api_url);
  const origin = (public_origin ?? settings.api_url_on_this_machine).replace(/\/$/u, '');
  return {
    webhook_url: `${origin}/v1/triggers/deliveries/webhook/${trigger_id}`,
    reaches_outside_this_machine: public_origin !== null,
  };
}
