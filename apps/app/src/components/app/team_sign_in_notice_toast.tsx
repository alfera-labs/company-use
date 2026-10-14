import { useEffect } from 'react';
import { toast } from 'sonner';
import { mark_sign_in_notice_seen } from '@/lib/api/team_mode';
import type { TeamArrival, TeamSignInNotice } from '@/lib/team_arrival';

/**
 * Tells a person, right after a sign-in, about the sign-in before it: when a link was last
 * used for their account, and who made that link. If it was not them, somebody else was
 * signed in as them. The session that earlier link made was never told this, so whoever took
 * the account could not clear it. Only a page that really showed it tells the API so. It shows
 * at the top of the page, away from the box a person types in.
 */
export function TeamSignInNoticeToast({ arrival }: { arrival: TeamArrival }) {
  const { sign_in_notice: notice, viewer_role } = arrival;
  useEffect(() => {
    if (!notice) return;
    toast.info(team_sign_in_notice_words(notice, viewer_role), {
      duration: 30_000,
      position: 'top-center',
    });
    void mark_sign_in_notice_seen();
  }, [notice, viewer_role]);
  return null;
}

const link_words: Record<TeamSignInNotice['link_kind'], (made_by_name: string) => string> = {
  invitation: (made_by_name) => `the invitation made by ${made_by_name}`,
  command_line: () => 'a link from the command line of the server',
  new_link: (made_by_name) => `a new sign-in link made by ${made_by_name}`,
};

/** One sign-in in words: when, with which kind of link, and who made the link. */
export function team_sign_in_words(sign_in: TeamSignInNotice): string {
  const used_time = new Date(sign_in.used_time).toLocaleString(undefined, { hourCycle: 'h23' });
  return `${used_time}, with ${link_words[sign_in.link_kind](sign_in.made_by_name)}`;
}

export function team_sign_in_notice_words(
  notice: TeamSignInNotice,
  viewer_role: string | null,
): string {
  const what_to_do =
    viewer_role === 'owner'
      ? 'make a new link with ./alfera team link on the machine that runs Alfera. It ends every other session.'
      : 'tell an owner.';
  return `Your sign-in before this one: ${team_sign_in_words(notice)}. If that was not you, ${what_to_do}`;
}
