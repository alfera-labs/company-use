import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  is_blocked_address,
  is_blocked_host_name,
} from '@coworker/core/credentials/safe_outbound_url';

export class PublicUrlPolicyError extends Error {}

const default_timeout_ms = 20_000;
const max_redirects = 5;

export function is_http_url(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Throws a PublicUrlPolicyError naming the host unless it resolves to public addresses only.
 * The names and the address ranges are the ones of `safe_outbound_url`, so the read-a-page
 * tool and a connection's sign-in refuse the same hosts.
 */
export async function assert_public_hostname(hostname: string) {
  const host = normalize_url_hostname(hostname);
  if (is_blocked_host_name(host)) {
    throw new PublicUrlPolicyError(`URL host ${host} must be public`);
  }

  const addresses = await resolve_hostname_addresses(host);
  if (addresses.length === 0) {
    throw new PublicUrlPolicyError(`URL host ${host} did not resolve`);
  }
  if (addresses.some((address) => isIP(address) === 0 || is_blocked_address(address))) {
    throw new PublicUrlPolicyError(`URL host ${host} resolves to a private or reserved address`);
  }
}

/** The same URL back, once its host is known to be public. */
export async function public_http_url(value: string) {
  const url = new URL(normalize_http_url(value));
  await assert_public_hostname(url.hostname);
  return url.toString();
}

/**
 * fetch, with the public-host check on the first URL and on each redirect target. Redirects are
 * followed here rather than by fetch, which is the only way to see each hop's host.
 */
export async function fetch_public_url(
  url: string,
  init: RequestInit = {},
  options: { timeout_ms?: number } = {},
): Promise<Response> {
  return fetch_public_url_hop(url, init, options.timeout_ms ?? default_timeout_ms, 0);
}

async function fetch_public_url_hop(
  url: string,
  init: RequestInit,
  timeout_ms: number,
  redirect_count: number,
): Promise<Response> {
  const checked_url = await public_http_url(url);
  const response = await fetch(checked_url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout_ms),
  });
  if (!is_redirect_response(response.status)) return response;

  const location = response.headers.get('location');
  if (!location) return response;
  if (redirect_count >= max_redirects) throw new Error('Too many redirects');

  const redirected_url = new URL(location, checked_url).toString();
  return fetch_public_url_hop(redirected_url, init, timeout_ms, redirect_count + 1);
}

function normalize_http_url(value: string) {
  const url = value.trim();
  if (!is_http_url(url)) throw new Error('Only http:// and https:// URLs are supported');
  return url;
}

async function resolve_hostname_addresses(hostname: string) {
  const ip_version = isIP(hostname);
  if (ip_version !== 0) return [hostname];

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => address.address);
}

function normalize_url_hostname(hostname: string) {
  return hostname.replace(/^\[/u, '').replace(/\]$/u, '').toLowerCase();
}

function is_redirect_response(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
