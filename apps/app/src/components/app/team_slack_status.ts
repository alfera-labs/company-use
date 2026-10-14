import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/api/endpoints';
import type { WorkspaceSlackPeople, WorkspaceSlackPerson } from '@/lib/api/workspace_slack_people';

export const slack_only_row_limit = 50;

export type MemberSlackWord = 'In Slack' | 'Not in Slack';

export type TeamSlackStatus = {
  slack_word_by_user_id: Map<string, MemberSlackWord>;
  slack_only_people: WorkspaceSlackPerson[];
  slack_only_more_count: number;
};

export function build_team_slack_status(input: {
  members: WorkspaceMember[] | undefined;
  invitations: WorkspaceInvitation[] | undefined;
  slack_people: WorkspaceSlackPeople | undefined;
}): TeamSlackStatus {
  const { members, invitations } = input;
  const people = input.slack_people?.people ?? [];
  const slack_emails = new Set(people.flatMap((person) => normalized_emails_of(person.email)));
  if (!members || !invitations || slack_emails.size === 0) {
    return { slack_word_by_user_id: new Map(), slack_only_people: [], slack_only_more_count: 0 };
  }

  const team_emails = new Set(
    [...members, ...invitations].map((person) => normalize_email(person.email)),
  );
  const slack_only_people = people
    .filter((person) => !person.email || !team_emails.has(normalize_email(person.email)))
    .sort((one, other) => one.name.localeCompare(other.name));

  return {
    slack_word_by_user_id: new Map(
      members.map((member) => [
        member.user_id,
        slack_emails.has(normalize_email(member.email)) ? 'In Slack' : 'Not in Slack',
      ]),
    ),
    slack_only_people: slack_only_people.slice(0, slack_only_row_limit),
    slack_only_more_count: Math.max(0, slack_only_people.length - slack_only_row_limit),
  };
}

function normalized_emails_of(email: string | null): string[] {
  return email ? [normalize_email(email)] : [];
}

function normalize_email(email: string): string {
  return email.trim().toLowerCase();
}
