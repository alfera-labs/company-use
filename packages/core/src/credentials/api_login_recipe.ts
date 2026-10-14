// What an api_login recipe may say, and what running one may answer.
//
// The recipe is DATA because real vendors differ in ways that are stable and
// discoverable, not in ways that need code:
//   · some require a visit first, to mint an anti-forgery cookie
//   · some require that cookie echoed back in a header (Angular double-submit)
//   · some signal a FAILED login with HTTP 200 and a field in the body
//
// That last one is not a curiosity. Acme Planner answers a wrong password with
// 200 and {"SIGNIN_FAIL": true}, so code that trusts the status code would treat
// a wrong password as a successful sign-in and store a useless session.
import { z } from 'zod';

export const api_login_recipe_schema = z
  .object({
    visit_first: z.string().url().optional(),
    post_credentials_to: z.string().url(),
    send_fields: z.record(z.string(), z.string()),
    echo_cookie_into_header: z
      .object({ cookie_named: z.string(), into_header: z.string() })
      .optional(),
    always_send_headers: z.record(z.string(), z.string()).default({}),
    successful_when_field: z.string().optional(),
    successful_when_value: z.string().optional(),
    confirm_by_fetching: z.string().url().optional(),
    rejected_when_any_field_present: z.array(z.string()).default([]),
    read_wait_minutes_from_field: z.string().optional(),
    session_lasts_minutes: z.number().int().positive().optional(),
    keep_cookies_named: z.array(z.string()).min(1),
  })
  .strict();

export type ApiLoginRecipe = z.infer<typeof api_login_recipe_schema>;

// A sign-in produces two kinds of header, and they have different scopes.
//
// `session_headers` carry the identity: the session cookies the recipe named and
// the anti-forgery header echoed from one of them. Their scope is the host, which
// is what a session is.
//
// `api_protocol_headers` select and shape the vendor's API: Accept, Content-Type,
// a version header. Their scope is the API surface, not the host. Acme Planner
// answers `/app` with 404 and an empty body when a request carries
// `Accept: application/json`, and with the real page when it does not.
//
// They are returned separately because the egress door matches on host alone and
// therefore cannot serve the second scope. Merging them into one record is how
// the API headers came to be attached to every page request on the host.
export type ApiLoginResult =
  | {
      signed_in: true;
      session_headers: Readonly<Record<string, string>>;
      api_protocol_headers: Readonly<Record<string, string>>;
      session_lasts_minutes?: number | undefined;
    }
  | {
      signed_in: false;
      outcome: 'rejected' | 'rate_limited' | 'misconfigured' | 'unreachable';
      message: string;
      wait_minutes?: number | undefined;
    };
