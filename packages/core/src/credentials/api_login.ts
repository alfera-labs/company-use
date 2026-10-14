import type { ApiLoginRecipe, ApiLoginResult } from '@coworker/core/credentials/api_login_recipe';
import {
  format_cookie_header,
  read_cookies_from_response,
} from '@coworker/core/credentials/cookie_header';
import { separate_publishable_headers } from '@coworker/core/credentials/credential_shaped_header';
import {
  decide_whether_to_fetch,
  type LookupAddresses,
} from '@coworker/core/credentials/safe_outbound_url';
import {
  describe_unreadable_answer,
  read_json_object,
} from '@coworker/core/credentials/sign_in_answer';

type SendRequest = typeof fetch;

const sign_in_timeout_ms = 10_000;

async function find_unsafe_address(
  recipe: ApiLoginRecipe,
  allowed_hosts: readonly string[],
  lookup_addresses: LookupAddresses | undefined,
): Promise<ApiLoginResult | null> {
  const lookup = lookup_addresses ?? resolve_addresses;
  const addresses = [recipe.post_credentials_to, recipe.visit_first, recipe.confirm_by_fetching];
  for (const url of addresses) {
    if (!url) continue;
    const verdict = await decide_whether_to_fetch({ url, allowed_hosts, lookup_addresses: lookup });
    if (!verdict.may_fetch) {
      return {
        signed_in: false,
        outcome: 'misconfigured',
        message: `This sign-in cannot be used: ${verdict.because}.`,
      };
    }
  }
  return null;
}

async function resolve_addresses(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

type VisitResult = { cookies: Record<string, string> } | { refusal: ApiLoginResult };

async function visit_for_cookies(recipe: ApiLoginRecipe, send: SendRequest): Promise<VisitResult> {
  if (!recipe.visit_first) return { cookies: {} };
  const response = await send(recipe.visit_first, {
    headers: recipe.always_send_headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(sign_in_timeout_ms),
  });
  const refusal = describe_redirect(response);
  if (refusal) return { refusal };
  return { cookies: read_cookies_from_response(response) };
}

// The address was checked before the request was sent. Node follows a redirect
// across origins and keeps our headers and body, so the second address would
// receive the password without ever being checked. A redirect ends the sign-in.
function describe_redirect(response: Response): ApiLoginResult | null {
  const redirected = response.status >= 300 && response.status < 400;
  if (!redirected) return null;
  return {
    signed_in: false,
    outcome: 'misconfigured',
    message: `That site answered ${response.status} and sent us to another address. Point this sign-in at the address that site redirects to.`,
  };
}

function generate_login_body(
  recipe: ApiLoginRecipe,
  field_values: Readonly<Record<string, string>>,
): string {
  const body: Record<string, string> = {};
  for (const [wire_name, our_name] of Object.entries(recipe.send_fields)) {
    const value = field_values[our_name];
    if (value === undefined) throw new Error(`credential_field_missing:${our_name}`);
    body[wire_name] = value;
  }
  return JSON.stringify(body);
}

function read_rejection(
  recipe: ApiLoginRecipe,
  body: Record<string, unknown>,
): ApiLoginResult | null {
  const wait_field = recipe.read_wait_minutes_from_field;
  const wait_value = wait_field ? body[wait_field] : undefined;
  const wait_minutes = typeof wait_value === 'number' && wait_value > 0 ? wait_value : 0;
  if (wait_minutes > 0) {
    return {
      signed_in: false,
      outcome: 'rate_limited',
      message: `That site asked us to wait ${wait_minutes} minutes before trying again.`,
      wait_minutes,
    };
  }

  for (const field of recipe.rejected_when_any_field_present) {
    const value = body[field];
    if (value === undefined || value === null || value === false) continue;
    return {
      signed_in: false,
      outcome: 'rejected',
      message: 'That site did not accept the saved username and password.',
    };
  }

  if (
    recipe.successful_when_field &&
    body[recipe.successful_when_field] !== recipe.successful_when_value
  ) {
    return {
      signed_in: false,
      outcome: 'misconfigured',
      message: 'That site did not confirm the sign-in.',
    };
  }
  return null;
}

export async function sign_in_with_api_login(input: {
  recipe: ApiLoginRecipe;
  field_values: Readonly<Record<string, string>>;
  allowed_hosts: readonly string[];
  send_request?: SendRequest | undefined;
  lookup_addresses?: LookupAddresses | undefined;
}): Promise<ApiLoginResult> {
  const send = input.send_request ?? fetch;
  const { recipe } = input;

  const refusal = await find_unsafe_address(recipe, input.allowed_hosts, input.lookup_addresses);
  if (refusal) return refusal;

  const visit = await visit_for_cookies(recipe, send);
  if ('refusal' in visit) return visit.refusal;
  const cookies = visit.cookies;

  const echoed = recipe.echo_cookie_into_header;
  const echo_header =
    echoed && cookies[echoed.cookie_named]
      ? { [echoed.into_header]: cookies[echoed.cookie_named] as string }
      : {};

  const response = await send(recipe.post_credentials_to, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...recipe.always_send_headers,
      ...echo_header,
      ...(Object.keys(cookies).length ? { Cookie: format_cookie_header(cookies) } : {}),
    },
    body: generate_login_body(recipe, input.field_values),
    redirect: 'manual',
    signal: AbortSignal.timeout(sign_in_timeout_ms),
  });

  const redirected = describe_redirect(response);
  if (redirected) return redirected;

  const body = await read_json_object(response);
  if (!body) return describe_unreadable_answer(response);

  const rejected = read_rejection(recipe, body);
  if (rejected) return rejected;

  return generate_signed_in_result(recipe, {
    ...cookies,
    // Some vendors upgrade the visitor cookie in place and send nothing back, so
    // start from what we already hold and let any new cookie win.
    ...read_cookies_from_response(response),
  });
}

function generate_signed_in_result(
  recipe: ApiLoginRecipe,
  session_cookies: Readonly<Record<string, string>>,
): ApiLoginResult {
  const kept = Object.fromEntries(
    recipe.keep_cookies_named
      .filter((name) => session_cookies[name] !== undefined)
      .map((name) => [name, session_cookies[name] as string]),
  );
  if (Object.keys(kept).length === 0) {
    return {
      signed_in: false,
      outcome: 'misconfigured',
      message: 'We signed in but that site did not keep us signed in.',
    };
  }

  const echoed = recipe.echo_cookie_into_header;
  const recipe_headers = separate_publishable_headers(recipe.always_send_headers);
  return {
    signed_in: true,
    ...(recipe.session_lasts_minutes
      ? { session_lasts_minutes: recipe.session_lasts_minutes }
      : {}),
    session_headers: {
      Cookie: format_cookie_header(kept),
      ...(echoed && kept[echoed.cookie_named]
        ? { [echoed.into_header]: kept[echoed.cookie_named] as string }
        : {}),
      ...recipe_headers.carries_a_credential,
    },
    api_protocol_headers: recipe_headers.publishable,
  };
}
