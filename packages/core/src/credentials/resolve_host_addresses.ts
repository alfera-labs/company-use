import { lookup } from 'node:dns/promises';
import {
  decide_whether_to_fetch,
  type LookupAddresses,
} from '@coworker/core/credentials/safe_outbound_url';

/**
 * The DNS half of the outbound-request guard, in one place. `decide_whether_to_fetch` takes it
 * injected so a test can hand it a fixed answer. Every answer of the name comes back, not the
 * first one alone: the second address of a name is where an attacker puts the private one.
 */
export async function resolve_host_addresses(hostname: string): Promise<string[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/**
 * Why one of our own processes (the API, the worker) must not send a request to this address,
 * or null when it may: https, a public name, and public addresses only after the lookup. A
 * caller that follows a redirect asks again for the address it leads to. The sandbox is cut
 * off from private addresses by its own guard; this is the same line for the processes that
 * sit next to the database and the other services.
 * The request then looks the name up a second time, so a name that changes its
 * answer between the two lookups gets through. Hand the checked address to the connection
 * (a lookup hook on the socket) when the runtime in use offers one.
 */
export async function find_reason_not_to_reach(
  url: string,
  lookup_addresses: LookupAddresses = resolve_host_addresses,
): Promise<string | null> {
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const verdict = await decide_whether_to_fetch({ url, allowed_hosts: [host], lookup_addresses });
  return verdict.may_fetch ? null : verdict.because;
}

/**
 * The same question for an address that was checked when it was saved (the address of an MCP
 * server, the token address of its sign-in), asked again right before each request, because a
 * name can point somewhere else by then. An inside name, an inside address and a name that now
 * resolves inside are refused. A name that cannot be looked up at this moment is left to the
 * request, which then fails by itself.
 */
export async function find_reason_not_to_reach_again(
  url: string,
  lookup_addresses: LookupAddresses = resolve_host_addresses,
): Promise<string | null> {
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const verdict = await decide_whether_to_fetch({ url, allowed_hosts: [host], lookup_addresses });
  return verdict.may_fetch || verdict.lookup_failed ? null : verdict.because;
}

/** Thrown before any request is sent, when the address is not one our own processes may reach. */
export class AddressNotReachedError extends Error {}

/**
 * `fetch` for a saved address that a person, the model or another server once handed to the
 * API or the worker. Nothing is sent unless `find_reason_not_to_reach_again` lets the address
 * through, and a redirect is an error, because nothing checked where it leads.
 */
export async function fetch_outside_address(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const refusal = await find_reason_not_to_reach_again(url);
  if (refusal) throw new AddressNotReachedError(`No request was sent: ${refusal}.`);
  return fetch(url, { ...init, redirect: 'error' });
}
