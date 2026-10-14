import type { ApiLoginResult } from '@coworker/core/credentials/api_login_recipe';
import { z } from 'zod';

const json_object_schema = z.record(z.string(), z.unknown());

/**
 * The status is the whole diagnosis and used to be thrown away. Sites commonly
 * answer a wrongly-shaped sign-in request with a 404 HTML page rather than a 401
 * — Acme Planner does — so "we could not read that" without the status sends
 * someone hunting for a broken password when a header is missing.
 */
export function describe_unreadable_answer(response: Response): ApiLoginResult {
  const content_type = response.headers.get('content-type')?.split(';')[0] ?? 'nothing';
  const shape = `answered ${response.status} with ${content_type}, not JSON`;
  if (response.status === 404 || response.status === 400) {
    return {
      signed_in: false,
      outcome: 'misconfigured',
      message: `That site ${shape}. A ${response.status} here usually means the request is missing something the site expects rather than the address being wrong — check the sign-in request address, and add any header its own sign-in page sends.`,
    };
  }
  return {
    signed_in: false,
    outcome: response.status >= 500 ? 'unreachable' : 'misconfigured',
    message: `That site ${shape}.`,
  };
}

export async function read_json_object(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = json_object_schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
