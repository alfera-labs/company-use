import type { Database } from '@coworker/core';

export const referral_cookie_name = 'referral';

export function parse_referral_cookie(_cookie_value: string | undefined): string | null {
  return null;
}

export async function persist_referral_attribution(
  _db: Database,
  _input: { referrer_workspace_id: string; invitee_workspace_id: string; actor_id: string },
) {}
