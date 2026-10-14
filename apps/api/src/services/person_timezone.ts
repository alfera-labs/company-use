import type { Database } from '@coworker/core';
import { read_user_timezone, set_user_timezone } from '@coworker/core/db/queries/user_timezone';
import { ValidationError } from '@coworker/shared';

const offset_pattern = /^[+-]/u;

/** True for a time zone name such as Europe/Rome. False for an offset such as +02:00. */
export function is_iana_timezone_name(timezone: string) {
  if (offset_pattern.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function read_person_timezone(db: Database, user_id: string) {
  return { timezone: await read_user_timezone(db, user_id) };
}

export async function set_person_timezone(
  db: Database,
  input: { user_id: string; timezone: string },
) {
  if (!is_iana_timezone_name(input.timezone)) {
    throw new ValidationError('Use an IANA time zone name, for example Europe/Rome.');
  }
  await set_user_timezone(db, { ...input, actor_id: input.user_id });
  return { timezone: input.timezone };
}
