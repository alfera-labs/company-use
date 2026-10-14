import { env } from '@coworker/config';
import { read_api_origin } from '@coworker/config/api_origin';
import type { Database } from '@coworker/core';
import {
  find_pending_connection_setup_by_short_code,
  read_connection_setup_short_code,
} from '@coworker/core/db/queries/connection_setup_short_code';
import { build_connection_start_url } from '@runtime-platform/connections/connection_start_link';

const connection_start_link_pattern =
  /https?:\/\/[^\s)\]]+\/connect\/start\?connection_id=[\w-]+&setup_token=([\w-]+)/g;

export const connection_short_link_path = '/v1/c/';

/** For channels where a long link reads badly: the same setup behind a short redirect link. */
export function shorten_connection_start_links(text: string): string {
  return text.replace(connection_start_link_pattern, (_link, setup_token: string) => {
    const short_code = read_connection_setup_short_code(setup_token);
    return new URL(
      `${connection_short_link_path}${short_code}`,
      env.API_PUBLIC_URL ?? read_api_origin(),
    ).href;
  });
}

export async function find_connection_start_url_by_short_code(
  db: Database,
  short_code: string,
): Promise<string | null> {
  const setup = await find_pending_connection_setup_by_short_code(db, short_code);
  return setup ? build_connection_start_url(setup) : null;
}
