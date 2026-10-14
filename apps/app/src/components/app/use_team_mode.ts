// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message, is_workspace_administrator_role } from '@coworker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ShownSignInLink } from '@/components/app/team_mode_link_box';
import { removal_summary_words, team_member_name } from '@/components/app/team_mode_words';
import { ApiError } from '@/lib/api/client';
import {
  chat_of_person_query_key,
  invite_team_member,
  make_team_member_sign_in_link,
  read_chat_of_person,
  read_team,
  remove_team_member,
  set_team_member_role,
  type TeamMember,
  team_query_key,
  team_viewer_role_query_key,
} from '@/lib/api/team_mode';

export function use_team() {
  return useQuery({ queryKey: team_query_key, queryFn: read_team });
}

/**
 * The role of the person in a team-mode install, or null in an install of any other mode. The
 * page shell stores it when the app opens, so nothing is asked of the API here.
 */
export function use_team_viewer_role(): string | null {
  const role = useQuery<string | null>({
    queryKey: team_viewer_role_query_key,
    queryFn: () => null,
    enabled: false,
  }).data;
  return role ?? null;
}

/** True for a plain member of a team-mode install: a person who cannot change what the team shares. */
export function use_is_plain_team_member(): boolean {
  const role = use_team_viewer_role();
  return role !== null && !is_workspace_administrator_role(role);
}

/**
 * True when a person of a team-mode install opened the address of a chat they may not read, or
 * of no chat at all. It is asked only for a chat that is not in the person's own list.
 */
export function use_chat_is_not_this_persons(
  session_id: string | undefined,
  is_not_in_the_list: boolean,
): boolean {
  const runs_in_team_mode = use_team_viewer_role() !== null;
  const { error } = useQuery({
    queryKey: chat_of_person_query_key(session_id),
    queryFn: () => read_chat_of_person(session_id ?? ''),
    enabled: runs_in_team_mode && is_not_in_the_list && Boolean(session_id),
    retry: false,
  });
  return error instanceof ApiError && error.status === 404;
}

/** Every change to the team. A change that makes a link hands it to `show_link`, once. */
export function use_team_changes(show_link: (link: ShownSignInLink) => void) {
  const query_client = useQueryClient();
  const reload_team = () => query_client.invalidateQueries({ queryKey: team_query_key });
  const say_why_not = (fallback: string) => (error: unknown) =>
    toast.error(format_error_message(error, fallback));

  const invite = useMutation({
    mutationFn: invite_team_member,
    onSuccess: async ({ member, sign_in_link }) => {
      await reload_team();
      show_link({
        person_name: team_member_name(member),
        token: sign_in_link.token,
        lasts: '2 days',
      });
    },
    onError: say_why_not('Could not invite this person'),
  });

  const make_link = useMutation({
    mutationFn: (member: TeamMember) => make_team_member_sign_in_link(member.user_id),
    onSuccess: (sign_in_link, member) =>
      show_link({
        person_name: team_member_name(member),
        token: sign_in_link.token,
        lasts: member.member_status === 'active' ? '1 hour' : '2 days',
      }),
    onError: say_why_not('Could not make a sign-in link'),
  });

  const change_role = useMutation({
    mutationFn: set_team_member_role,
    onSuccess: reload_team,
    onError: say_why_not('Could not change the role'),
  });

  const remove = useMutation({
    mutationFn: (removal: { member: TeamMember; keeps_connections: boolean }) =>
      remove_team_member({ user_id: removal.member.user_id, ...removal }),
    onSuccess: async (removed, { member }) => {
      await reload_team();
      toast.success(removal_summary_words(team_member_name(member), removed), { duration: 20_000 });
    },
    onError: say_why_not('Could not remove this person'),
  });

  return { invite, make_link, change_role, remove };
}

export type TeamChanges = ReturnType<typeof use_team_changes>;
