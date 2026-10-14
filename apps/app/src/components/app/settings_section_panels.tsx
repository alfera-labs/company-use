import { SettingsCard, SettingsRow } from '@coworker/ui/components/settings-card';
import { Skeleton } from '@coworker/ui/components/skeleton';
import type { ReactNode } from 'react';
import { AccessTableSettings } from '@/components/app/access_table_settings';
import { ApiKeySettings } from '@/components/app/api_key_settings';
import { ChannelSettings } from '@/components/app/channel_settings';
import { DesktopNotificationSettings } from '@/components/app/desktop_notification_settings';
import { edition_settings_panels } from '@/components/app/edition_settings_panels';
import { EmailAddressSettings } from '@/components/app/email_address_settings';
import { EmptyNote } from '@/components/app/empty_note';
import { ModelSettings } from '@/components/app/model_settings';
import { TeamModeAdminsOnly } from '@/components/app/team_mode_admins_only';
import { TeamModeProfile } from '@/components/app/team_mode_profile';
import { TeamModeSettings } from '@/components/app/team_mode_settings';
import { TeamSettings } from '@/components/app/team_settings';
import { ThemeSettings } from '@/components/app/theme_settings';
import { TimezoneSettings } from '@/components/app/timezone_settings';
import { WorkspacePolicySettings } from '@/components/app/workspace_policy_settings';
import { WorkspaceSettings } from '@/components/app/workspace_settings';
import { client_only_lazy } from '@/components/client_only_lazy';
import type { SettingsSectionId } from '@/lib/settings_navigation';

// The WorkOS profile panel brings its own Radix Themes runtime and a large stylesheet, and it
// fetches its own data from the browser anyway — nothing about it can render on the server.
// Loading it on demand keeps that weight off every other section, which is a bigger win now
// that a section is a page of its own rather than one card in a long scroll.
const WorkosProfilePanel = client_only_lazy(
  async () => ({
    default: (await import('@/components/app/workos_widget_frame')).WorkosProfilePanel,
  }),
  <WidgetSkeleton />,
);

export type SettingsPanelContext = {
  profile_token: string | null;
  team_token_can_manage_users: boolean;
  runs_in_local_mode?: boolean;
  runs_in_team_mode?: boolean;
};

export const settings_section_panels: Record<
  SettingsSectionId,
  (context: SettingsPanelContext) => ReactNode
> = {
  profile: ({ profile_token, runs_in_local_mode, runs_in_team_mode }) => {
    if (profile_token) return <WorkosProfilePanel authToken={profile_token} />;
    if (runs_in_local_mode) return <LocalModeNote>there is no account to manage</LocalModeNote>;
    if (runs_in_team_mode) return <TeamModeProfile />;
    return <EmptyNote>Profile management needs a WorkOS widget token.</EmptyNote>;
  },

  preferences: () => (
    <SettingsCard>
      <SettingsRow title="Appearance" description="Choose how the dashboard looks.">
        <ThemeSettings />
      </SettingsRow>
      <SettingsRow
        title="Time zone"
        description="Your coworker uses this time zone when it tells you a time in chat and when it sets a schedule for you."
      >
        <TimezoneSettings />
      </SettingsRow>
      <DesktopNotificationSettings />
    </SettingsCard>
  ),

  workspace: ({ runs_in_team_mode }) =>
    runs_in_team_mode ? (
      <TeamModeAdminsOnly what="the name of the workspace">
        <WorkspaceSettings />
      </TeamModeAdminsOnly>
    ) : (
      <WorkspaceSettings />
    ),
  models: ({ runs_in_team_mode }) =>
    runs_in_team_mode ? (
      <TeamModeAdminsOnly what="the model">
        <ModelSettings />
      </TeamModeAdminsOnly>
    ) : (
      <ModelSettings />
    ),
  channels: () => <ChannelSettings />,

  team: ({ team_token_can_manage_users, runs_in_local_mode, runs_in_team_mode }) => {
    if (runs_in_team_mode) return <TeamModeSettings />;
    if (team_token_can_manage_users) return <TeamSettings />;
    if (runs_in_local_mode) return <TurnTeamModeOnNote />;
    return <TeamManagementUnavailable />;
  },

  email: () => <EmailAddressSettings />,
  access: () => <AccessTableSettings />,
  'api-keys': () => <ApiKeySettings />,
  policies: ({ runs_in_team_mode }) =>
    runs_in_team_mode ? (
      <TeamModeAdminsOnly what="what each tool may do without asking">
        <WorkspacePolicySettings />
      </TeamModeAdminsOnly>
    ) : (
      <WorkspacePolicySettings />
    ),
  ...edition_settings_panels,
};

function WidgetSkeleton() {
  return <Skeleton className="h-64 w-full rounded-3xl" />;
}

function LocalModeNote({ children }: { children: ReactNode }) {
  return (
    <EmptyNote>
      This Alfera runs in local mode, for one person on this machine, so {children}. Set up sign-in
      to work as a team.
    </EmptyNote>
  );
}

function TurnTeamModeOnNote() {
  return (
    <EmptyNote>
      This Alfera runs in local mode, with no sign-in. Run{' '}
      <code className="text-xs">./alfera team link</code> in the install folder to turn sign-in on.
      You then invite people here with one-time links, with no outside account. Your chats stay.
    </EmptyNote>
  );
}

function TeamManagementUnavailable() {
  // The settings route redirects when the session has no organization, so reaching this state
  // means the workspace exists but the signed-in role lacks the WorkOS
  // `widgets:users-table:manage` permission. Say that plainly instead of blaming a missing
  // organization.
  return (
    <EmptyNote>
      Managing the team needs admin access. If you already have it, an admin has to enable team
      management for this workspace in WorkOS.
    </EmptyNote>
  );
}
