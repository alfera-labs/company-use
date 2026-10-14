import { useQuery } from '@tanstack/react-query';
import { OwnRecoveryCodeSettings } from '@/components/app/own_recovery_code_settings';
import { TeamModeMatchEmail } from '@/components/app/team_mode_match_email';
import { TeamModeNameField } from '@/components/app/team_mode_name_field';
import { TeamModeSignOutEverywhere } from '@/components/app/team_mode_sign_out_everywhere';
import { team_sign_in_words } from '@/components/app/team_sign_in_notice_toast';
import { read_sign_in_password, sign_in_password_query_key } from '@/lib/api/sign_in_password';
import { own_team_account_query_key, read_own_team_account } from '@/lib/api/team_mode';

/**
 * Settings → Profile when the install signs people in itself: there is a session to end, and a
 * password only for the owner who made one on the setup page. It lists each time a link signed
 * this person in, newest first. A line the person does not know is somebody else in their
 * account: every use of a link is there, also one that ended their session.
 */
export function TeamModeProfile() {
  const password = useQuery({
    queryKey: sign_in_password_query_key,
    queryFn: read_sign_in_password,
  });
  return (
    <div className="flex flex-col items-start gap-3 text-sm">
      <TeamModeNameField />
      <TeamModeMatchEmail />
      {password.error ? (
        <p className="text-muted-foreground">
          Alfera could not check how you sign in.{' '}
          <button type="button" className="underline" onClick={() => void password.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      {password.data?.has_password ? <OwnRecoveryCodeSettings /> : null}
      {password.data?.has_password === false ? (
        <p className="text-muted-foreground">
          This workspace signs people in with one-time links, so there is no password to manage. A
          session ends 30 days after it started.
        </p>
      ) : null}
      <RecentSignIns />
      <p className="text-muted-foreground">
        If a browser or a device you signed in on is lost, end every session now.{' '}
        {password.data?.has_password
          ? 'You then sign in again with your password.'
          : 'You then need a new sign-in link to come back.'}
      </p>
      <TeamModeSignOutEverywhere />
    </div>
  );
}

function RecentSignIns() {
  const account = useQuery({
    queryKey: own_team_account_query_key,
    queryFn: read_own_team_account,
  });
  const sign_ins = account.data?.sign_ins ?? [];
  if (sign_ins.length === 0) return null;
  return (
    <section aria-label="Recent sign-ins" className="flex flex-col gap-1">
      <h3 className="font-medium">Recent sign-ins</h3>
      <ul className="text-muted-foreground">
        {sign_ins.map((sign_in) => (
          <li key={sign_in.used_time}>{team_sign_in_words(sign_in)}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        If one of these was not you, sign out everywhere and tell an owner.
      </p>
    </section>
  );
}
